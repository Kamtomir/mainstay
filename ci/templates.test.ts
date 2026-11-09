/**
 * The CI templates are code too. These checks keep them copyable:
 *   - no secrets: everything runs on the workflow's own token;
 *   - explicit, narrow permissions at the top;
 *   - a timeout on every job (a hung job bills until GitHub kills it at 6 h);
 *   - actions pinned to a version, never a moving branch;
 *   - every script a template calls exists in this folder;
 *   - push and pull_request ignore the same paths (two copies of one rule drift);
 *   - expressions use only the contexts GitHub allows where they stand. A
 *     `job.` expression in a job's own `env` makes the whole file invalid: no job
 *     starts, and the run fails with "Unrecognized named-value: 'job'". That
 *     happened to this repository's first push; this check came with the fix.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const CI = fileURLToPath(new URL(".", import.meta.url));
const OWN = fileURLToPath(new URL("../.github/workflows", import.meta.url));

interface Step {
  uses?: string;
  run?: string;
}
interface Job {
  uses?: string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, unknown>;
  services?: Record<string, unknown>;
  "timeout-minutes"?: number;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string> | string;
  env?: Record<string, unknown>;
  concurrency?: unknown;
  jobs: Record<string, Job>;
}

/**
 * Contexts GitHub allows per location (docs: "Contexts", context availability).
 * Steps may use more (job, runner, env, steps); these keys may not.
 */
const ALLOWED_CONTEXTS = {
  "workflow env": ["github", "secrets", "inputs", "vars"],
  concurrency: ["github", "inputs", "vars"],
  "job env": ["github", "needs", "strategy", "matrix", "vars", "secrets", "inputs"],
  "job if": ["github", "needs", "vars", "inputs"],
  services: ["github", "needs", "strategy", "matrix", "vars", "secrets", "inputs"],
} as const;

/** The expressions in a value: the inside of every ${{ }}, or the whole string for an `if`. */
function expressions(value: unknown, wholeIsExpression = false): string[] {
  if (typeof value === "string") {
    const inner = [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]);
    return inner.length > 0 ? inner : wholeIsExpression ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v) => expressions(v));
  if (value && typeof value === "object") return Object.values(value).flatMap((v) => expressions(v));
  return [];
}

/** Named values an expression reads: `job` in job.services.x, `needs` in needs.a.outputs.b. Not functions. */
function namedValues(expression: string): string[] {
  const code = expression.replace(/'(?:[^']|'')*'/g, "''");
  return [...code.matchAll(/(^|[^\w.'-])([A-Za-z_][\w-]*)(?=\s*[.[])/g)].map((m) => m[2]);
}

const files = [
  ...readdirSync(CI).filter((f) => f.endsWith(".yml")).map((f) => join(CI, f)),
  ...(existsSync(OWN) ? readdirSync(OWN).filter((f) => f.endsWith(".yml")).map((f) => join(OWN, f)) : []),
];
const load = (path: string) => ({ path, name: basename(path), text: readFileSync(path, "utf8"), doc: parse(readFileSync(path, "utf8")) as Workflow });
const workflows = files.map(load);
const template = (name: string) => workflows.find((w) => w.path === join(CI, name))!;

describe("CI templates", () => {
  it("finds the three templates and the harness's own workflow", () => {
    expect(workflows.map((w) => w.name)).toEqual(expect.arrayContaining(["guard-first.yml", "integration-postgres.yml", "deploy-watchdog.yml", "test.yml"]));
  });

  it.each(workflows.map((w) => [w.name, w] as const))("%s: no secrets", (_n, w) => {
    // An expression that reads a secret, e.g. ${{ secrets.DEPLOY_KEY }}. Prose may say "secrets".
    expect(w.text).not.toMatch(/\$\{\{[^}]*\bsecrets\./);
  });

  it.each(workflows.map((w) => [w.name, w] as const))("%s: explicit permissions, never write-all", (_n, w) => {
    expect(typeof w.doc.permissions).toBe("object");
    expect(JSON.stringify(w.doc.permissions)).not.toMatch(/write-all/);
  });

  it.each(workflows.map((w) => [w.name, w] as const))("%s: every job has a timeout", (_n, w) => {
    const missing = Object.entries(w.doc.jobs)
      .filter(([, job]) => !job.uses && typeof job["timeout-minutes"] !== "number")
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });

  it.each(workflows.map((w) => [w.name, w] as const))("%s: actions are pinned to a version", (_n, w) => {
    const loose = Object.values(w.doc.jobs)
      .flatMap((job) => job.steps ?? [])
      .map((s) => s.uses)
      .filter((u): u is string => !!u && !u.startsWith("./"))
      .filter((u) => !/@(v\d+(\.\d+)*|[0-9a-f]{40})$/.test(u));
    expect(loose).toEqual([]);
  });

  it("every script a template calls ships in ci/", () => {
    const referenced = workflows
      .filter((w) => w.path.startsWith(CI))
      .flatMap((w) => [...w.text.matchAll(/\.github\/scripts\/(\w[\w.-]*\.(?:sh|mjs|js))/g)].map((m) => m[1]));
    const shipped = new Set([...readdirSync(CI), ...readdirSync(join(CI, "migrations"))]);
    expect([...new Set(referenced)].filter((s) => !shipped.has(s))).toEqual([]);
  });

  it.each(workflows.map((w) => [w.name, w] as const))("%s: expressions use only the contexts allowed where they stand", (_n, w) => {
    const misplaced: string[] = [];
    const check = (where: keyof typeof ALLOWED_CONTEXTS, label: string, found: string[]) => {
      for (const e of found) {
        for (const name of namedValues(e)) {
          if (!(ALLOWED_CONTEXTS[where] as readonly string[]).includes(name)) misplaced.push(`${label}: "${name}" in ${e.trim()}`);
        }
      }
    };
    check("workflow env", "env", expressions(w.doc.env));
    check("concurrency", "concurrency", expressions(w.doc.concurrency));
    for (const [id, job] of Object.entries(w.doc.jobs)) {
      check("job env", `jobs.${id}.env`, expressions(job.env));
      check("job if", `jobs.${id}.if`, expressions(job.if, true));
      check("services", `jobs.${id}.services`, expressions(job.services));
    }
    expect(misplaced, "move these into a step (a step's env or run may use job, runner, steps)").toEqual([]);
  });

  it("the context check sees a misplaced job context (it is not passing on nothing)", () => {
    expect(namedValues(" job.services.postgres.ports['5432'] ")).toEqual(["job"]);
    expect(namedValues("needs.should-run.outputs.run == 'true' && contains(github.ref, 'main')")).toEqual(["needs", "github"]);
    expect(namedValues("inputs.sha && '0' || '60'")).toEqual(["inputs"]);
  });

  it("guard-first: guards gate the long jobs, and the reusable workflow exists", () => {
    const { jobs } = template("guard-first.yml").doc;
    expect(jobs.guards.needs).toBe("should-run");
    expect(jobs.guards.if).toBe("needs.should-run.outputs.run == 'true'");
    expect(jobs["test-build"].needs).toBe("guards");
    expect(jobs.integration.needs).toBe("guards");
    expect(basename(jobs.integration.uses!)).toBe("integration-postgres.yml");
    expect(existsSync(join(CI, "integration-postgres.yml"))).toBe(true);
  });

  it("guard-first: push and pull_request ignore the same paths", () => {
    const on = template("guard-first.yml").doc.on as Record<string, { "paths-ignore"?: string[] }>;
    expect(on.push["paths-ignore"]).toEqual(on.pull_request["paths-ignore"]);
  });

  it("the watchdog runs on a schedule and can be run by hand in dry-run mode", () => {
    const on = template("deploy-watchdog.yml").doc.on as Record<string, unknown>;
    expect(on).toHaveProperty("schedule");
    expect(on).not.toHaveProperty("push");
    expect(JSON.stringify(on.workflow_dispatch)).toMatch(/"dry_run".*"default":true/);
  });
});
