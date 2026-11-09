/**
 * Tests for deploy-watchdog.mjs with a fake commit graph and an in-memory
 * GitHub API: no network, no repository.
 */
import { describe, expect, it } from "vitest";
import { assess, deploys, isIgnored, MARKER, planIssues, run } from "./deploy-watchdog.mjs";

const NOW = 1_800_000_000_000;
const minutesAgo = (m: number) => Math.floor(NOW / 1000) - m * 60;

interface Commit {
  sha: string;
  parent?: string;
  files: string[];
  subject: string;
  time: number;
}

/** Answers the git commands the watchdog runs; commits are listed newest first. */
function fakeGit(commits: Commit[]) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  return (args: string[]): string => {
    const [cmd, ...rest] = args;
    const last = rest[rest.length - 1];
    if (cmd === "rev-list") return commits.map((c) => c.sha).join("\n");
    if (cmd === "rev-parse" && last.endsWith("^{commit}")) {
      const sha = last.slice(0, -"^{commit}".length);
      if (bySha.has(sha)) return sha;
      throw new Error("unknown revision");
    }
    if (cmd === "rev-parse" && last.endsWith("^")) {
      const parent = bySha.get(last.slice(0, -1))?.parent;
      if (parent) return parent;
      throw new Error("no parent");
    }
    if (cmd === "diff") return bySha.get(last)!.files.join("\n");
    if (cmd === "log") return rest.includes("--format=%s") ? bySha.get(last)!.subject : String(bySha.get(last)!.time);
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

interface Issue {
  number: number;
  title: string;
  state: "open" | "closed";
}

function fakeGitHub(deployments: { id: number; environment: string; sha: string }[], statuses: Record<number, string[]>, issues: Issue[] = []) {
  const calls: string[] = [];
  const api = async (method: string, path: string, body?: { title?: string; state?: string }) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (method === "GET" && path.includes("/deployments?")) {
      const sha = new URLSearchParams(path.split("?")[1]).get("sha");
      return deployments.filter((d) => d.sha === sha);
    }
    if (method === "GET" && /\/deployments\/\d+\/statuses/.test(path)) {
      const id = Number(/deployments\/(\d+)/.exec(path)![1]);
      return (statuses[id] ?? []).map((state) => ({ state }));
    }
    if (method === "GET" && path.includes("/issues?")) return issues;
    if (method === "POST" && path.endsWith("/issues")) {
      const issue: Issue = { number: 100 + issues.length, title: body!.title!, state: "open" };
      issues.push(issue);
      return { number: issue.number };
    }
    if (method === "POST" && path.endsWith("/comments")) return {};
    if (method === "PATCH") {
      issues.find((i) => i.number === Number(path.split("/").pop()))!.state = "closed";
      return {};
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { api, calls, issues };
}

const ENV = { REPO: "o/r", ENVIRONMENTS: "Production – web,Production – api", IGNORE_PATHS: "docs/ *.md", THRESHOLD_MIN: "25" };
const CODE: Commit = { sha: "c0de0000aaaa", parent: "base0000aaaa", files: ["src/app.ts"], subject: "feat: orders", time: minutesAgo(60) };
const DOCS: Commit = { sha: "d0c50000bbbb", parent: CODE.sha, files: ["docs/guide.md", "README.md"], subject: "docs: guide", time: minutesAgo(5) };
const BASE: Commit = { sha: "base0000aaaa", files: ["src/app.ts"], subject: "init", time: minutesAgo(600) };
const ok = (sha = CODE.sha) => [
  { id: 1, environment: "Production – web", sha },
  { id: 2, environment: "Production – api", sha },
];

async function watch(commits: Commit[], gh: ReturnType<typeof fakeGitHub>, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await run({ env: { ...ENV, ...env }, git: fakeGit(commits), github: gh.api, now: () => NOW, log: (l: string) => lines.push(l) });
  return { code, out: lines.join("\n") };
}

describe("deploy-watchdog: pure parts", () => {
  it("ignore patterns: prefix, extension, exact path or directory", () => {
    expect(isIgnored("docs/a/b.png", ["docs/"])).toBe(true);
    expect(isIgnored("src/notes.md", ["*.md"])).toBe(true);
    expect(isIgnored("LICENSE", ["LICENSE"])).toBe(true);
    expect(isIgnored("src/docs.ts", ["docs/", "*.md"])).toBe(false);
  });

  it("a commit deploys when it touches anything outside the ignore list; a root commit always does", () => {
    expect(deploys(["docs/a.md", "src/x.ts"], ["docs/"])).toBe(true);
    expect(deploys(["docs/a.md"], ["docs/"])).toBe(false);
    expect(deploys(null, ["docs/"])).toBe(true);
  });

  it("matches environments exactly: a preview named like production does not count", () => {
    const r = assess([{ id: 1, environment: "Preview – Production – web" }], { 1: ["success"] }, ["Production – web"]);
    expect(r).toEqual([{ environment: "Production – web", ok: false, reason: "no deployment at all" }]);
  });

  it("an issue per commit: an open one is not duplicated, a closed one means stay quiet", () => {
    const title = `${MARKER}: c0de0000`;
    const missing = [{ environment: "web", ok: false, reason: "x" }];
    expect(planIssues(missing, title, [])).toEqual({ action: "open" });
    expect(planIssues(missing, title, [{ number: 7, title, state: "open" }]).action).toBe("none");
    expect(planIssues(missing, title, [{ number: 7, title, state: "closed" }]).why).toMatch(/closed by a person/);
    expect(planIssues([], title, [{ number: 7, title, state: "open" }])).toEqual({ action: "close", numbers: [7] });
  });
});

describe("deploy-watchdog: a run", () => {
  it("skips a docs-only tip and checks the newest code commit; all deployed → exit 0", async () => {
    const gh = fakeGitHub(ok(), { 1: ["pending", "success"], 2: ["success"] });
    const r = await watch([DOCS, CODE, BASE], gh);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/skipped by design: d0c50000/);
    expect(r.out).toMatch(/In production: c0de0000/);
  });

  it("a commit younger than the threshold is not checked yet", async () => {
    const gh = fakeGitHub([], {});
    const r = await watch([{ ...CODE, time: minutesAgo(10) }, BASE], gh);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Too early/);
    expect(gh.calls).toEqual([]);
  });

  it("an environment without a deployment → exit 1 and one issue for this commit", async () => {
    const gh = fakeGitHub([{ id: 1, environment: "Production – web", sha: CODE.sha }], { 1: ["success"] });
    const r = await watch([CODE, BASE], gh);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/MISSING Production – api: no deployment at all/);
    expect(gh.issues.map((i) => i.title)).toEqual([`${MARKER}: c0de0000`]);
  });

  it("a deployment that failed is missing too, with its own reason", async () => {
    const gh = fakeGitHub(ok(), { 1: ["success"], 2: ["in_progress", "failure"] });
    const r = await watch([CODE, BASE], gh);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/MISSING Production – api: a deployment was created but none succeeded/);
  });

  it("dry run: reports, opens nothing", async () => {
    const gh = fakeGitHub([], {});
    const r = await watch([CODE, BASE], gh, { DRY_RUN: "1" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/dry run, issue not opened/);
    expect(gh.issues).toEqual([]);
  });

  it("caught up: closes the watchdog's open issues, leaves other issues alone", async () => {
    const issues: Issue[] = [
      { number: 7, title: `${MARKER}: 0ld00000`, state: "open" },
      { number: 8, title: "Unrelated bug", state: "open" },
    ];
    const gh = fakeGitHub(ok(), { 1: ["success"], 2: ["success"] }, issues);
    const r = await watch([CODE, BASE], gh);
    expect(r.code).toBe(0);
    expect(issues.map((i) => `${i.number}:${i.state}`)).toEqual(["7:closed", "8:open"]);
  });

  it("warns about a production environment nobody listed", async () => {
    const gh = fakeGitHub([...ok(), { id: 3, environment: "Production – admin", sha: CODE.sha }], { 1: ["success"], 2: ["success"] });
    const r = await watch([CODE, BASE], gh);
    expect(r.out).toMatch(/Unlisted production environment "Production – admin"/);
  });

  it("a manual check of a commit that is not in the checkout is a setup error", async () => {
    const r = await watch([CODE, BASE], fakeGitHub([], {}), { SHA_OVERRIDE: "deadbeef" });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not in this checkout/);
  });
});
