#!/usr/bin/env node
/**
 * baseline.mjs: day-zero quality numbers from the GitHub API.
 *
 *   OWNER=acme REPO=web GITHUB_TOKEN=... node metrics/baseline.mjs
 *   OWNER=acme REPO=web GITHUB_TOKEN=... DAYS=90 WORKFLOW=ci.yml node metrics/baseline.mjs --json
 *
 * For the last DAYS days it reports (definitions in metrics/METRICS.md):
 *   - merged PRs, and the share of code PRs that change at least one test file;
 *   - CI runs: how many, the red share, median and p90 duration;
 *   - flaky signal: commits whose CI both failed and passed with no code change;
 *   - red-to-green time on the default branch;
 *   - escaped defects: issues labelled ESCAPED_LABEL opened in the window.
 *
 * Environment
 *   OWNER, REPO      the repository
 *   GITHUB_TOKEN     read-only is enough: contents, pull requests, actions, issues
 *   DAYS             window length (default 30)
 *   WORKFLOW         a workflow file (ci.yml) to restrict the CI numbers to; default all
 *   BRANCH           the default branch (default main)
 *   TEST_PATTERN     regex for test files (default: .test./.spec. files and test(s)/ dirs)
 *   DOCS_PATTERN     regex for files that do not make a PR a code PR (default: docs/ and *.md)
 *   ESCAPED_LABEL    label of escaped-defect issues (default escaped-defect)
 *   MAX_PRS          merged PRs whose files are inspected (default 200)
 *   MIN_RUN_MINUTES  runs shorter than this count as gated, not timed (default 0;
 *                    with a should-run gate, set it just above the gate's own time)
 *   API_URL          for GitHub Enterprise (default https://api.github.com)
 *
 * No dependencies: Node 20+.
 */
import { pathToFileURL } from "node:url";

const DEFAULT_TEST = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)(?:tests?|__tests__)\/)/;
const DEFAULT_DOCS = /(?:^docs\/)|(?:\.md$)/;
const RED = new Set(["failure", "timed_out", "startup_failure"]);

const minutesBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 60000;
const round = (n, digits = 1) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits);

/** Nearest-rank percentile; null for no data. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/**
 * CI runs: volume, red share and duration. Red = failure, timed out or failed
 * to start. With a should-run gate, a skipped run ends green in seconds: runs
 * shorter than `minRunMinutes` are counted as gated and left out of the
 * duration figures, so they do not drag the median down.
 */
export function summarizeRuns(runs, minRunMinutes = 0) {
  const completed = runs.filter((r) => r.status === "completed");
  const minutes = (r) => minutesBetween(r.run_started_at ?? r.created_at, r.updated_at);
  // A gated run is a short GREEN run: the gate said "nothing to do". A short red
  // run is a real failure (it broke early) and stays in.
  const isGated = (r) => r.conclusion === "success" && minutes(r) < minRunMinutes;
  const ran = completed.filter((r) => (r.conclusion === "success" || RED.has(r.conclusion)) && !isGated(r));
  const green = ran.filter((r) => r.conclusion === "success").length;
  const red = ran.filter((r) => RED.has(r.conclusion)).length;
  const durations = ran.map(minutes).filter((m) => m >= 0);
  return {
    runs: runs.length,
    completed: completed.length,
    green,
    red,
    cancelled: completed.filter((r) => r.conclusion === "cancelled").length,
    gated: completed.filter(isGated).length,
    redShare: green + red > 0 ? round(red / (green + red), 3) : null,
    medianMinutes: round(percentile(durations, 50)),
    p90Minutes: round(percentile(durations, 90)),
  };
}

/**
 * Flaky signal at run level: a commit whose runs of one workflow both failed
 * and passed, or a run that went green on a re-run. Same code, different
 * result. A lower bound: test-level flakes need the test reporter's history.
 */
export function flakySignal(runs) {
  const byCommit = new Map();
  for (const r of runs.filter((x) => x.status === "completed")) {
    const key = `${r.workflow_id ?? ""}:${r.head_sha}`;
    const entry = byCommit.get(key) ?? { green: false, red: false, rerunGreen: false };
    if (r.conclusion === "success") entry.green = true;
    if (RED.has(r.conclusion)) entry.red = true;
    if (r.conclusion === "success" && (r.run_attempt ?? 1) > 1) entry.rerunGreen = true;
    byCommit.set(key, entry);
  }
  const flaky = [...byCommit.values()].filter((e) => (e.green && e.red) || e.rerunGreen).length;
  return { commits: byCommit.size, flaky, share: byCommit.size > 0 ? round(flaky / byCommit.size, 3) : null };
}

/** Time from the first red run on the branch to the next green one, per red spell. */
export function redToGreen(runs, branch) {
  const onBranch = runs
    .filter((r) => r.status === "completed" && r.head_branch === branch && r.event === "push")
    .filter((r) => r.conclusion === "success" || RED.has(r.conclusion))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const spells = [];
  let redSince = null;
  for (const r of onBranch) {
    if (RED.has(r.conclusion) && redSince === null) redSince = r.updated_at;
    if (r.conclusion === "success" && redSince !== null) {
      spells.push(minutesBetween(redSince, r.updated_at));
      redSince = null;
    }
  }
  return {
    spells: spells.length,
    stillRed: redSince !== null,
    medianMinutes: round(percentile(spells, 50)),
    maxMinutes: round(spells.length ? Math.max(...spells) : null),
  };
}

/** Share of merged code PRs that change at least one test file. Docs-only PRs do not count. */
export function prsWithTests(filesByPr, testPattern = DEFAULT_TEST, docsPattern = DEFAULT_DOCS) {
  const code = [...filesByPr.values()].filter((files) => files.some((f) => !docsPattern.test(f)));
  const withTests = code.filter((files) => files.some((f) => testPattern.test(f))).length;
  return { inspected: filesByPr.size, codePrs: code.length, withTests, share: code.length ? round(withTests / code.length, 3) : null };
}

/**
 * GitHub REST client with Link-header pagination.
 * @param {{ token?: string, apiUrl?: string, fetchImpl?: FetchLike, maxPages?: number }} options
 */
export function githubClient({ token, apiUrl = "https://api.github.com", fetchImpl = fetch, maxPages = 10 }) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  async function get(url) {
    const res = await fetchImpl(url.startsWith("http") ? url : `${apiUrl}${url}`, { headers });
    if (!res.ok) throw new Error(`GitHub GET ${url}: ${res.status} ${await res.text()}`);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
    return { body: await res.json(), next };
  }
  /** All pages, or until `stop(item)` says the rest is older than the window. */
  async function list(path, { key, stop } = {}) {
    const items = [];
    let url = path;
    for (let page = 0; url && page < maxPages; page++) {
      const { body, next } = await get(url);
      const batch = key ? body[key] : body;
      for (const item of batch) {
        if (stop?.(item)) return items;
        items.push(item);
      }
      url = next;
    }
    return items;
  }
  return { get, list };
}

/**
 * @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<Response>} FetchLike
 *
 * @typedef {object} CollectOptions
 * @property {string} owner
 * @property {string} repo
 * @property {string} [token]
 * @property {number} [days]
 * @property {number} [now]           epoch milliseconds; tests pin it
 * @property {string} [workflow]      workflow file name, e.g. "ci.yml"
 * @property {string} [branch]
 * @property {RegExp} [testPattern]
 * @property {RegExp} [docsPattern]
 * @property {string} [escapedLabel]
 * @property {number} [maxPrs]
 * @property {string} [apiUrl]
 * @property {FetchLike} [fetchImpl]
 * @property {number} [maxPages]
 * @property {number} [minRunMinutes] runs shorter than this are "gated" (skipped by a should-run gate)
 */

/** @param {CollectOptions} options */
export async function collect({ owner, repo, token, days = 30, now = Date.now(), workflow, branch = "main", testPattern, docsPattern, escapedLabel = "escaped-defect", maxPrs = 200, apiUrl, fetchImpl, maxPages, minRunMinutes = 0 }) {
  const gh = githubClient({ token, apiUrl, fetchImpl, maxPages });
  const since = new Date(now - days * 86400000);
  const sinceIso = since.toISOString();
  const base = `/repos/${owner}/${repo}`;

  const closed = await gh.list(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`, {
    stop: (pr) => Date.parse(pr.updated_at) < since.getTime(),
  });
  const merged = closed.filter((pr) => pr.merged_at && Date.parse(pr.merged_at) >= since.getTime());
  const filesByPr = new Map();
  for (const pr of merged.slice(0, maxPrs)) {
    const files = await gh.list(`${base}/pulls/${pr.number}/files?per_page=100`);
    filesByPr.set(pr.number, files.map((f) => f.filename));
  }

  const runsPath = workflow ? `${base}/actions/workflows/${workflow}/runs` : `${base}/actions/runs`;
  const runs = await gh.list(`${runsPath}?created=%3E%3D${sinceIso.slice(0, 10)}&per_page=100`, { key: "workflow_runs" });

  const issues = await gh.list(`${base}/issues?state=all&labels=${encodeURIComponent(escapedLabel)}&since=${sinceIso}&per_page=100`);
  const escaped = issues.filter((i) => !i.pull_request && Date.parse(i.created_at) >= since.getTime());

  return {
    repository: `${owner}/${repo}`,
    window: { days, since: sinceIso, until: new Date(now).toISOString() },
    pullRequests: { merged: merged.length, ...prsWithTests(filesByPr, testPattern, docsPattern) },
    ci: { workflow: workflow ?? "all", minRunMinutes, ...summarizeRuns(runs, minRunMinutes) },
    flaky: flakySignal(runs),
    redToGreen: redToGreen(runs, branch),
    escapedDefects: { label: escapedLabel, opened: escaped.length },
  };
}

const pct = (x) => (x === null ? "n/a" : `${round(x * 100)}%`);
const min = (x) => (x === null ? "n/a" : `${x} min`);

export function render(m) {
  const rows = [
    ["Merged PRs", String(m.pullRequests.merged)],
    ["Code PRs with tests", `${pct(m.pullRequests.share)} (${m.pullRequests.withTests} of ${m.pullRequests.codePrs} code PRs; ${m.pullRequests.inspected} PRs inspected)`],
    ["CI runs", `${m.ci.runs} (${m.ci.workflow}), ${m.ci.cancelled} cancelled${m.ci.gated ? `, ${m.ci.gated} gated (under ${m.ci.minRunMinutes} min)` : ""}`],
    ["Red share of CI runs", pct(m.ci.redShare)],
    ["CI time, median / p90", `${min(m.ci.medianMinutes)} / ${min(m.ci.p90Minutes)}`],
    ["Flaky signal", `${pct(m.flaky.share)} of ${m.flaky.commits} commits`],
    ["Red to green on main, median / max", `${min(m.redToGreen.medianMinutes)} / ${min(m.redToGreen.maxMinutes)} over ${m.redToGreen.spells} spells${m.redToGreen.stillRed ? ", red now" : ""}`],
    ["Escaped defects opened", `${m.escapedDefects.opened} (label "${m.escapedDefects.label}")`],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  return [`${m.repository}, last ${m.window.days} days (${m.window.since.slice(0, 10)} to ${m.window.until.slice(0, 10)})`, "", ...rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`)].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  if (!env.OWNER || !env.REPO) {
    console.error("Set OWNER and REPO (and GITHUB_TOKEN for private repositories). See the header of this file.");
    process.exit(2);
  }
  collect({
    owner: env.OWNER,
    repo: env.REPO,
    token: env.GITHUB_TOKEN,
    days: Number(env.DAYS ?? 30),
    workflow: env.WORKFLOW || undefined,
    branch: env.BRANCH ?? "main",
    testPattern: env.TEST_PATTERN ? new RegExp(env.TEST_PATTERN) : undefined,
    docsPattern: env.DOCS_PATTERN ? new RegExp(env.DOCS_PATTERN) : undefined,
    escapedLabel: env.ESCAPED_LABEL ?? "escaped-defect",
    maxPrs: Number(env.MAX_PRS ?? 200),
    minRunMinutes: Number(env.MIN_RUN_MINUTES ?? 0),
    apiUrl: env.API_URL,
  })
    .then((m) => console.log(process.argv.includes("--json") ? JSON.stringify(m, null, 2) : render(m)))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
