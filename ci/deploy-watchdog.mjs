#!/usr/bin/env node
/**
 * deploy-watchdog.mjs: is the newest deployable commit on main in production?
 *
 * 1. Walks back from the tip of main (first parents only) to the newest commit
 *    that changes something outside IGNORE_PATHS: a docs-only commit is not
 *    expected to deploy, so it is skipped by design.
 * 2. Gives it THRESHOLD_MIN minutes to build and deploy.
 * 3. Reads GitHub Deployments for that commit and wants a "success" status in
 *    every environment named in ENVIRONMENTS, matched exactly: a preview
 *    environment whose name ends like the production one must never count.
 * 4. Missing anywhere: opens one issue per commit and exits 1. All there:
 *    closes the watchdog's open issues and exits 0.
 *
 * Environment:
 *   GITHUB_TOKEN   the workflow token (contents, deployments: read; issues: write)
 *   REPO           owner/name
 *   ENVIRONMENTS   comma-separated production environment names, e.g. "Production"
 *   IGNORE_PATHS   space-separated: "docs/" (prefix), "*.md" (extension), "LICENSE" (exact)
 *   THRESHOLD_MIN  minutes to wait before a commit is late (default 25)
 *   LOOKBACK       commits to walk back (default 30)
 *   SHA_OVERRIDE   check this commit instead of the tip
 *   DRY_RUN        1 = print what would happen to issues, change nothing
 *   HEAD_REF       the branch tip to start from (default HEAD)
 *
 * Exit codes: 0 in production, too early or nothing to check; 1 production is
 * behind; 2 a setup error.
 *
 * No dependencies: Node 20+ (global fetch) and git.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const MARKER = "Deploy watchdog: production is behind main";

/** "docs/" is a prefix, "*.md" an extension anywhere, anything else an exact path or directory. */
export function isIgnored(file, patterns) {
  return patterns.some((p) => {
    if (p.endsWith("/")) return file.startsWith(p);
    if (p.startsWith("*.")) return file.endsWith(p.slice(1));
    return file === p || file.startsWith(`${p}/`);
  });
}

/** A commit deploys when it changes a path outside the ignore list. A root commit (null) always does. */
export function deploys(changedFiles, patterns) {
  if (changedFiles === null) return true;
  return changedFiles.some((f) => !isIgnored(f, patterns));
}

/** For each expected environment: does the commit have a successful deployment there? */
export function assess(deployments, statesById, environments) {
  return environments.map((environment) => {
    const ids = deployments.filter((d) => d.environment === environment).map((d) => d.id);
    const ok = ids.some((id) => (statesById[id] ?? []).includes("success"));
    const reason = ok ? "" : ids.length > 0 ? "a deployment was created but none succeeded" : "no deployment at all";
    return { environment, ok, reason };
  });
}

/** Production-looking environments nobody listed: a new project the watchdog would not notice falling behind. */
export function unlistedProduction(deployments, environments) {
  return [...new Set(deployments.map((d) => d.environment))].filter((e) => /^production\b/i.test(e) && !environments.includes(e));
}

/**
 * What to do with issues. One issue per commit: a second loss gets its own
 * issue instead of hiding behind the first. A closed issue with the same title
 * means a person looked and said "stay quiet".
 */
export function planIssues(missing, title, issues) {
  if (missing.length === 0) {
    const open = issues.filter((i) => i.state === "open" && i.title.startsWith(MARKER)).map((i) => i.number);
    return { action: open.length > 0 ? "close" : "none", numbers: open };
  }
  const open = issues.find((i) => i.title === title && i.state === "open");
  if (open) return { action: "none", why: `issue #${open.number} is already open` };
  const closed = issues.find((i) => i.title === title && i.state === "closed");
  if (closed) return { action: "none", why: `issue #${closed.number} was closed by a person: staying quiet` };
  return { action: "open" };
}

function issueBody({ sha, subject, ageMin, missing, repo }) {
  const lines = missing.map((m) => `- **${m.environment}**: ${m.reason}`).join("\n");
  return `Commit \`${sha}\` (${subject}) was merged ${ageMin} minutes ago and has no successful production deployment:

${lines}

Two different causes, fixed differently. Tell them apart first:

1. **The push event was lost.** The commit then has no CI runs either.
2. **The push arrived, the deploy did not happen or failed.** CI runs exist; look at the host's build log.

\`\`\`
gh api repos/${repo}/commits/${sha}/check-runs --jq '.check_runs[].name'
gh api "repos/${repo}/deployments?sha=${sha}" --jq '.[].environment'
\`\`\`

To catch up, redeploy this commit from your host (a failed build does not touch production).
This issue closes itself when the deployment appears.`;
}

export async function run({ env, git, github, now = () => Date.now(), log = console.log }) {
  const repo = env.REPO;
  const environments = (env.ENVIRONMENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!repo || environments.length === 0) {
    log("::error::REPO and ENVIRONMENTS are required.");
    return 2;
  }
  const ignore = (env.IGNORE_PATHS ?? "").split(/\s+/).filter(Boolean);
  const threshold = Number(env.THRESHOLD_MIN ?? 25);
  const lookback = Number(env.LOOKBACK ?? 30);
  const dryRun = env.DRY_RUN === "1";

  const tryGit = (args) => {
    try {
      return git(args).trim();
    } catch {
      return null;
    }
  };
  const changed = (sha) => (tryGit(["rev-parse", "--verify", "--quiet", `${sha}^`]) ? git(["diff", "--name-only", `${sha}^`, sha]).split("\n").filter(Boolean) : null);

  let expected = null;
  if (env.SHA_OVERRIDE) {
    expected = tryGit(["rev-parse", "--verify", "--quiet", `${env.SHA_OVERRIDE}^{commit}`]);
    if (!expected) {
      log(`::error::Commit ${env.SHA_OVERRIDE} is not in this checkout. For a manual check, use fetch-depth 0.`);
      return 2;
    }
    if (!deploys(changed(expected), ignore)) {
      log(`${expected.slice(0, 8)} only touches ignored paths: it is not expected to deploy. Nothing to check.`);
      return 0;
    }
  } else {
    const commits = git(["rev-list", "--first-parent", "-n", String(lookback), env.HEAD_REF ?? "HEAD"]).split("\n").filter(Boolean);
    for (const sha of commits) {
      if (deploys(changed(sha), ignore)) {
        expected = sha;
        break;
      }
      log(`  skipped by design: ${sha.slice(0, 8)} only touches ignored paths`);
    }
    if (!expected) {
      log(`No deployable commit in the last ${lookback}. Nothing to check.`);
      return 0;
    }
  }

  const subject = git(["log", "-1", "--format=%s", expected]).trim();
  const ageMin = Math.floor((now() / 1000 - Number(git(["log", "-1", "--format=%ct", expected]).trim())) / 60);
  log(`Expected in production: ${expected.slice(0, 8)} (${ageMin} min ago): ${subject}`);
  if (!env.SHA_OVERRIDE && ageMin < threshold) {
    log(`Younger than ${threshold} min: the deploy may still be running. Too early to check.`);
    return 0;
  }

  const deployments = await github("GET", `/repos/${repo}/deployments?sha=${expected}&per_page=100`);
  const statesById = {};
  for (const d of deployments.filter((d) => environments.includes(d.environment))) {
    const statuses = await github("GET", `/repos/${repo}/deployments/${d.id}/statuses?per_page=100`);
    statesById[d.id] = statuses.map((s) => s.state);
  }
  for (const e of unlistedProduction(deployments, environments)) {
    log(`::warning::Unlisted production environment "${e}": add it to ENVIRONMENTS or the watchdog will not notice it falling behind.`);
  }

  const results = assess(deployments, statesById, environments);
  for (const r of results) log(r.ok ? `  ok      ${r.environment}` : `  MISSING ${r.environment}: ${r.reason}`);
  const missing = results.filter((r) => !r.ok);

  const title = `${MARKER}: ${expected.slice(0, 8)}`;
  const issues = (await github("GET", `/repos/${repo}/issues?state=all&per_page=100`)).filter((i) => !i.pull_request);
  const plan = planIssues(missing, title, issues);

  if (missing.length === 0) {
    log(`In production: ${expected.slice(0, 8)} in all ${environments.length} environment(s).`);
    if (plan.action === "close" && !dryRun) {
      for (const n of plan.numbers) {
        await github("POST", `/repos/${repo}/issues/${n}/comments`, { body: `Caught up: \`${expected.slice(0, 8)}\` is in production. Closing.` });
        await github("PATCH", `/repos/${repo}/issues/${n}`, { state: "closed" });
        log(`Closed issue #${n}.`);
      }
    }
    return 0;
  }

  const body = issueBody({ sha: expected, subject, ageMin, missing, repo });
  if (plan.action === "open") {
    if (dryRun) log(`--- dry run, issue not opened: ${title}\n${body}`);
    else {
      const issue = await github("POST", `/repos/${repo}/issues`, { title, body });
      log(`Opened issue #${issue.number}.`);
    }
  } else {
    log(plan.why);
  }
  log(`::error::Production is behind main: ${expected.slice(0, 8)} is missing in ${missing.map((m) => m.environment).join(", ")}`);
  return 1;
}

function githubClient(token) {
  return async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GITHUB_TOKEN) {
    console.log("::error::GITHUB_TOKEN is required.");
    process.exit(2);
  }
  const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  run({ env: process.env, git, github: githubClient(process.env.GITHUB_TOKEN) })
    .then((code) => process.exit(code))
    .catch((error) => {
      console.log(`::error::${error.message}`);
      process.exit(2);
    });
}
