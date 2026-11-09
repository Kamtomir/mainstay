/**
 * The CI templates are code too. These checks keep them copyable:
 *   - no secrets: everything runs on the workflow's own token;
 *   - explicit, narrow permissions at the top;
 *   - a timeout on every job (a hung job bills until GitHub kills it at 6 h);
 *   - actions pinned to a version, never a moving branch;
 *   - every script a template calls exists in this folder;
 *   - push and pull_request ignore the same paths (two copies of one rule drift).
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
  "timeout-minutes"?: number;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string> | string;
  jobs: Record<string, Job>;
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
