/**
 * Tests for agent/pre-push.sh in a throwaway git repository. The guard command
 * is replaced by one that leaves a marker, so the test sees whether it ran.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("./pre-push.sh", import.meta.url));
const ZERO = "0".repeat(40);
const repo = mkdtempSync(join(tmpdir(), "mainstay-hook-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd: repo, encoding: "utf8" }).trim();

function commit(files: Record<string, string>, message: string): string {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

git("init", "-q", "-b", "feature/x");
const base = commit({ "src/app.ts": "export const a = 1;\n" }, "base");
const docs = commit({ "docs/guide.md": "# Guide\n" }, "docs");
const code = commit({ "src/app.ts": "export const a = 2;\n" }, "code");

let n = 0;
function push(line: string, guards = "true") {
  const marker = join(repo, `.ran-${++n}`);
  const res = spawnSync("bash", [HOOK], {
    cwd: repo,
    input: `${line}\n`,
    env: { ...process.env, MAINSTAY_GUARDS: `${guards} && touch ${marker}` },
    encoding: "utf8",
  });
  return { code: res.status, out: res.stdout + res.stderr, ran: existsSync(marker) };
}

describe.skipIf(process.platform === "win32")("pre-push.sh", () => {
  it("refuses a push to main and runs nothing", () => {
    const r = push(`refs/heads/feature/x ${code} refs/heads/main ${base}`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/refusing to push to main/);
    expect(r.ran).toBe(false);
  });

  it("runs the guards when code changed", () => {
    const r = push(`refs/heads/feature/x ${code} refs/heads/feature/x ${base}`);
    expect(r.code, r.out).toBe(0);
    expect(r.ran).toBe(true);
  });

  it("a failing guard blocks the push", () => {
    const r = push(`refs/heads/feature/x ${code} refs/heads/feature/x ${base}`, "false");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/a guard failed/);
  });

  it("skips the guards when only docs changed", () => {
    const r = push(`refs/heads/feature/x ${docs} refs/heads/feature/x ${base}`);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/only docs changed/);
    expect(r.ran).toBe(false);
  });

  it("deleting a remote branch checks nothing", () => {
    const r = push(`(delete) ${ZERO} refs/heads/old-branch ${base}`);
    expect(r.code).toBe(0);
    expect(r.ran).toBe(false);
  });

  it("a new branch with no base to compare runs the guards", () => {
    const r = push(`refs/heads/feature/x ${code} refs/heads/feature/x ${ZERO}`);
    expect(r.code, r.out).toBe(0);
    expect(r.ran).toBe(true);
  });
});
