/**
 * Tests for metrics/baseline.mjs: the aggregation on fixture data, and one full
 * collection against a fake GitHub API (pagination included). No network.
 */
import { describe, expect, it } from "vitest";
import { collect, flakySignal, percentile, prsWithTests, redToGreen, render, summarizeRuns } from "./baseline.mjs";

const t = (minute: number) => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();
const run = (over: Record<string, unknown>) => ({
  status: "completed",
  conclusion: "success",
  head_sha: "a",
  head_branch: "main",
  event: "push",
  workflow_id: 1,
  run_attempt: 1,
  created_at: t(0),
  run_started_at: t(0),
  updated_at: t(10),
  ...over,
});

describe("aggregation", () => {
  it("percentile: nearest rank, null without data", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });

  it("runs: red share counts failures, timeouts and start failures against greens; cancelled runs are left out", () => {
    const s = summarizeRuns([
      run({}),
      run({ conclusion: "failure", updated_at: t(20) }),
      run({ conclusion: "timed_out", updated_at: t(30) }),
      run({ conclusion: "cancelled" }),
      run({ status: "in_progress", conclusion: null }),
    ]);
    expect(s).toMatchObject({ runs: 5, completed: 4, green: 1, red: 2, cancelled: 1, redShare: 0.667, medianMinutes: 20, p90Minutes: 30 });
  });

  it("short green runs are gated: out of the timing and the red share; a short red run stays in", () => {
    const s = summarizeRuns(
      [run({ updated_at: t(0) }), run({ updated_at: t(1) }), run({ updated_at: t(25) }), run({ conclusion: "failure", updated_at: t(1) })],
      2,
    );
    expect(s).toMatchObject({ green: 1, red: 1, gated: 2, redShare: 0.5, medianMinutes: 1, p90Minutes: 25 });
  });

  it("flaky: same commit both red and green, or green on a re-run", () => {
    const f = flakySignal([
      run({ head_sha: "a", conclusion: "failure" }),
      run({ head_sha: "a" }),
      run({ head_sha: "b", run_attempt: 2 }),
      run({ head_sha: "c" }),
      run({ head_sha: "d", conclusion: "failure" }),
    ]);
    expect(f).toEqual({ commits: 4, flaky: 2, share: 0.5 });
  });

  it("red to green: one spell from the first red to the next green, on the branch's pushes only", () => {
    const r = redToGreen(
      [
        run({ created_at: t(0), updated_at: t(10) }),
        run({ created_at: t(20), updated_at: t(30), conclusion: "failure" }),
        run({ created_at: t(40), updated_at: t(50), conclusion: "failure" }),
        run({ created_at: t(45), updated_at: t(55), event: "pull_request" }),
        run({ created_at: t(60), updated_at: t(90) }),
        run({ created_at: t(100), updated_at: t(110), conclusion: "failure" }),
      ],
      "main",
    );
    expect(r).toEqual({ spells: 1, stillRed: true, medianMinutes: 60, maxMinutes: 60 });
  });

  it("PRs with tests: docs-only PRs do not count as code PRs", () => {
    const files = new Map([
      [1, ["src/a.ts", "src/a.test.ts"]],
      [2, ["src/b.ts"]],
      [3, ["docs/guide.md"]],
      [4, ["lib/c.ts", "tests/c.spec.ts"]],
    ]);
    expect(prsWithTests(files)).toEqual({ inspected: 4, codePrs: 3, withTests: 2, share: 0.667 });
  });
});

describe("collect against a fake GitHub API", () => {
  const NOW = Date.parse("2026-11-07T00:00:00Z");
  const pages: Record<string, { body: unknown; next?: string }> = {
    "/repos/o/r/pulls?state=closed&sort=updated&direction=desc&per_page=100": {
      body: [
        { number: 3, merged_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-05T10:00:00Z" },
        { number: 2, merged_at: null, updated_at: "2026-11-04T10:00:00Z" },
      ],
      next: "https://api.example.test/page2",
    },
    "https://api.example.test/page2": {
      body: [
        { number: 1, merged_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" },
        { number: 0, merged_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-01T10:00:00Z" },
      ],
    },
    "/repos/o/r/pulls/3/files?per_page=100": { body: [{ filename: "src/x.ts" }, { filename: "src/x.test.ts" }] },
    "/repos/o/r/pulls/1/files?per_page=100": { body: [{ filename: "src/y.ts" }] },
    "/repos/o/r/actions/workflows/ci.yml/runs?created=%3E%3D2026-10-08&per_page=100": {
      body: { workflow_runs: [run({ head_sha: "x" }), run({ head_sha: "y", conclusion: "failure" })] },
    },
    "/repos/o/r/issues?state=all&labels=escaped-defect&since=2026-10-08T00:00:00.000Z&per_page=100": {
      body: [{ number: 9, created_at: "2026-10-30T00:00:00Z" }, { number: 10, created_at: "2026-10-31T00:00:00Z", pull_request: {} }],
    },
  };
  const seen: string[] = [];
  const fakeFetch = async (url: string, init: { headers: Record<string, string> }) => {
    const key = url.replace("https://api.github.com", "");
    seen.push(`${key} ${init.headers.authorization ?? "anonymous"}`);
    const page = pages[key];
    if (!page) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(page.body), {
      headers: page.next ? { link: `<${page.next}>; rel="next"` } : {},
    });
  };

  it("follows pagination, stops at the window, inspects merged PRs, filters issues", async () => {
    const m = await collect({ owner: "o", repo: "r", token: "t0ken", days: 30, now: NOW, workflow: "ci.yml", fetchImpl: fakeFetch });
    expect(m.pullRequests).toEqual({ merged: 2, inspected: 2, codePrs: 2, withTests: 1, share: 0.5 });
    expect(m.ci).toMatchObject({ workflow: "ci.yml", runs: 2, green: 1, red: 1, redShare: 0.5 });
    expect(m.escapedDefects).toEqual({ label: "escaped-defect", opened: 1 });
    expect(seen.every((s) => s.endsWith("Bearer t0ken"))).toBe(true);
    expect(render(m)).toMatch(/Code PRs with tests\s+50% \(1 of 2 code PRs; 2 PRs inspected\)/);
  });

  it("an API error is reported, not swallowed into zeros", async () => {
    await expect(collect({ owner: "o", repo: "missing", token: "t", now: NOW, fetchImpl: fakeFetch })).rejects.toThrow(/404/);
  });
});
