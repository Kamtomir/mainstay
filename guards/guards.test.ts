/**
 * Unit tests of the scanners: each must catch what it promises and nothing more.
 * The examples in guards/examples show the happy paths; these pin the edges.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { importSpecifiers, scanBundle } from "./bundle-guard";
import { attempt, scanReaders, STANDARD_FAILURES } from "./fail-closed";
import { flattenBudget, scanRatchet } from "./ratchet";
import { coverageProblems } from "./suite";
import { scanSurface } from "./surface-guard";
import { scanText } from "./text-guard";

const roots: string[] = [];
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mainstay-guards-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("scanText", () => {
  const rules = [
    { id: "console", pattern: /console\.log\(/, message: "use the logger" },
    { id: "debugger", pattern: /\bdebugger\b/, message: "remove it" },
  ];

  it("ignores comments and reports file, line and rule", () => {
    const root = tree({ "a.ts": "// console.log( in a comment\nconst x = 1;\nconsole.log(x);\n" });
    const r = scanText({ name: "t", root, rules });
    expect(r.violations.map((v) => `${v.file}:${v.line}:${v.rule}`)).toEqual(["a.ts:3:console"]);
  });

  it("an allowlist entry needs a reason", () => {
    const root = tree({ "a.ts": "console.log(1);\n" });
    expect(() => scanText({ name: "t", root, rules, allow: { "a.ts": "  " } })).toThrow(/no reason/);
  });

  it("an exemption covers only the rules it names", () => {
    const root = tree({ "a.ts": "console.log(1);\ndebugger;\n" });
    const r = scanText({ name: "t", root, rules, allow: { "a.ts": { reason: "CLI output", rules: ["console"] } } });
    expect(r.violations.map((v) => v.rule)).toEqual(["debugger"]);
    expect(r.stale).toEqual([]);
  });

  it("reports dead exemptions: a clean file and a missing file", () => {
    const root = tree({ "a.ts": "export const ok = 1;\n" });
    const r = scanText({ name: "t", root, rules, allow: { "a.ts": "was noisy", "gone.ts": "deleted" } });
    expect(r.stale).toEqual(["a.ts: no longer breaks the rule", "gone.ts: not found under the root"]);
  });
});

describe("scanSurface", () => {
  it("require: a surface file without the call is a violation; other files are not the surface", () => {
    const root = tree({
      "api/a/route.ts": "export async function GET(r: Request) { await requireUser(r); }\n",
      "api/b/route.ts": "export async function GET() { return Response.json([]); }\n",
      "lib/helper.ts": "export const x = 1;\n",
    });
    const r = scanSurface({ name: "s", root, files: /route\.ts$/, require: /\brequireUser\(/, requirement: "call requireUser" });
    expect(r.scanned).toEqual(["api/a/route.ts", "api/b/route.ts"]);
    expect(r.violations.map((v) => `${v.file} ${v.message}`)).toEqual(["api/b/route.ts does not call requireUser"]);
  });

  it("allow exempts a file, and an exemption for a compliant file is dead", () => {
    const root = tree({
      "api/a/route.ts": "await requireUser(r);\n",
      "api/health/route.ts": "export function GET() { return new Response('ok'); }\n",
    });
    const r = scanSurface({
      name: "s",
      root,
      files: /route\.ts$/,
      require: /\brequireUser\(/,
      allow: { "api/health/route.ts": "liveness probe", "api/a/route.ts": "old exemption" },
    });
    expect(r.violations).toEqual([]);
    expect(r.stale).toEqual(["api/a/route.ts: follows the rule now, drop the exemption"]);
  });

  it("needs a rule", () => {
    const root = tree({ "a.ts": "" });
    expect(() => scanSurface({ name: "s", root, files: /a/ })).toThrow(/require/);
  });
});

describe("scanBundle", () => {
  it("skips type-only imports and follows re-exports and .js specifiers", () => {
    expect(importSpecifiers('import type { A } from "./a";\nimport { type B, type C } from "./b";\nimport { d } from "./d";\nexport * from "./e";\n')).toEqual([
      "./d",
      "./e",
    ]);
    const root = tree({
      "ui/Widget.tsx": '"use client";\nimport { f } from "../lib/f.js";\nimport type { T } from "../lib/types";\n',
      "lib/f.ts": "export const f = (s: string) => s.replace(/(?<!x)y/, 'z');\n",
      "lib/types.ts": "export type T = string; const r = /(?<=a)b/;\n",
    });
    const r = scanBundle({ name: "b", root });
    expect(r.scanned).toEqual(["lib/f.ts", "ui/Widget.tsx"]);
    expect(r.violations.map((v) => `${v.file}:${v.line}`)).toEqual(["lib/f.ts:1"]);
  });

  it("a named group is fine", () => {
    const root = tree({ "a.tsx": '"use client";\nconst r = /(?<year>\\d{4})/;\n' });
    expect(scanBundle({ name: "b", root }).violations).toEqual([]);
  });
});

describe("scanReaders", () => {
  const files = {
    "a.ts": 'const r = await db.from("posts").select("*").eq("status", "published");\n',
    "b.ts": 'const r = await db.from("posts").select("*");\nconst onlyPublished = (q: any) => q.eq("status", "published");\n',
    "c.ts": 'const mine = await db.from("posts").select("*").eq("author_id", me);\n',
  };
  const base = {
    name: "r",
    reads: /\.from\(\s*["']posts["']\s*\)/,
    mustApply: /\.eq\(\s*["']status["']\s*,\s*["']published["']/,
    requirement: "the status filter",
  };

  it("chain scope wants the filter in the same statement", () => {
    const r = scanReaders({ ...base, root: tree(files) });
    expect(r.readers).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(r.violations.map((v) => v.file)).toEqual(["b.ts", "c.ts"]);
  });

  it("file scope accepts the filter anywhere in the file", () => {
    const r = scanReaders({ ...base, root: tree(files), scope: "file" });
    expect(r.violations.map((v) => v.file)).toEqual(["c.ts"]);
  });

  it("`when` narrows what counts as a reader", () => {
    const r = scanReaders({ ...base, root: tree(files), when: /author_id/ });
    expect(r.readers).toEqual(["c.ts"]);
  });
});

describe("scanRatchet", () => {
  it("flattens grouped budgets and sums a file listed twice", () => {
    expect([...flattenBudget({ A: { "x.ts": 1 }, B: { "x.ts": 2, "y.ts": 1 } })]).toEqual([
      ["x.ts", 3],
      ["y.ts", 1],
    ]);
  });

  it("counts in code only and honours regex exemptions", () => {
    const root = tree({
      "a.ts": "// legacy() in a comment\nlegacy();\nlegacy();\n",
      "flags/b.ts": "legacy();\n",
    });
    const r = scanRatchet({ name: "x", root, patterns: [/\blegacy\(\)/g], budget: { "a.ts": 2 }, exempt: [/^flags\//] });
    expect(r.violations).toEqual([]);
    expect([...r.actual]).toEqual([["a.ts", 2]]);
  });
});

describe("coverageProblems: a guard cannot pass on an empty scan", () => {
  const report = (scanned: string[]) => ({ root: "/r", scanned, violations: [], stale: [] });

  it("too few files is a problem", () => {
    expect(coverageProblems(report([]), 1)).toEqual(["scanned 0 file(s), expected at least 1: check the root and the filters"]);
  });

  it("a file the guard must see, missing from the scan, is a problem", () => {
    expect(coverageProblems(report(["a.ts"]), 1, ["a.ts", "b.ts"])).toEqual(["must see b.ts, but it is not in the scan"]);
  });

  it("enough files and every must-see file present: no problem", () => {
    expect(coverageProblems(report(["a.ts", "b.ts"]), 2, ["b.ts"])).toEqual([]);
  });
});

describe("attempt: what counts as failing closed", () => {
  const rows = async (source: () => unknown) => {
    const result = (await source()) as { data: { id: string }[] };
    return result.data.map((r) => r.id); // lets every error escape
  };

  it("a reader that throws is not closed: the page breaks instead of showing nothing", async () => {
    const out = await attempt({ name: "x", read: rows, empty: [] }, STANDARD_FAILURES.rejects);
    expect(out.closed).toBe(false);
    expect(String(out.error)).toMatch(/statement timeout/);
  });

  it("with allowThrow, a throw counts as closed: the caller shows an error, nothing leaks", async () => {
    const out = await attempt({ name: "x", read: rows, empty: [], allowThrow: true }, STANDARD_FAILURES.rejects);
    expect(out.closed).toBe(true);
  });

  it("returning the empty value is closed; returning anything else is not", async () => {
    expect((await attempt({ name: "x", read: async () => [], empty: [] }, STANDARD_FAILURES.rejects)).closed).toBe(true);
    expect((await attempt({ name: "x", read: async () => ["u1"], empty: [] }, STANDARD_FAILURES.rejects)).closed).toBe(false);
  });
});
