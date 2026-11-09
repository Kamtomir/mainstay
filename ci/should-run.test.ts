/**
 * Tests for should-run.sh with a stub `gh` on PATH: no network.
 *
 * The invariant: there is exactly ONE way to skip (same tree as the PR head and
 * a green run on it). Every other branch, an API failure included, must end in
 * run=true. Removing either check from the script turns a test here red.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./should-run.sh", import.meta.url));
const stubDir = mkdtempSync(join(tmpdir(), "mainstay-gh-"));
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

// The stub answers by URL; each answer comes from a scenario variable.
writeFileSync(
  join(stubDir, "gh"),
  `#!/usr/bin/env bash
url="$2"
[[ "\${GH_MODE:-ok}" == "down" ]] && exit 1
case "$url" in
  */commits/*/pulls)  [[ -n "\${S_PR:-}" ]] && printf '%s\\n' "$S_PR" ;;
  */pulls/*)          [[ -n "\${S_PR_HEAD:-}" ]] && printf '%s\\n' "$S_PR_HEAD" ;;
  */commits/MAINSHA)  [[ -n "\${S_MAIN_TREE:-}" ]] && printf '%s\\n' "$S_MAIN_TREE" ;;
  */commits/*)        [[ -n "\${S_PR_TREE:-}" ]] && printf '%s\\n' "$S_PR_TREE" ;;
  */runs\\?head_sha=*) printf '%s\\n' "\${S_GREEN:-0}" ;;
esac
exit 0
`,
);
chmodSync(join(stubDir, "gh"), 0o755);

function decide(env: Record<string, string>): string {
  const out = join(stubDir, `out-${Math.random().toString(36).slice(2)}`);
  writeFileSync(out, "");
  const res = spawnSync("bash", [SCRIPT], {
    env: { PATH: `${stubDir}:${process.env.PATH}`, GITHUB_OUTPUT: out, REPO: "o/r", SHA: "MAINSHA", EVENT: "push", ...env },
    encoding: "utf8",
  });
  expect(res.status, res.stderr).toBe(0);
  return readFileSync(out, "utf8").trim();
}

const SAME = { S_PR: "1052", S_PR_HEAD: "PRSHA", S_MAIN_TREE: "T1", S_PR_TREE: "T1" };

describe.skipIf(process.platform === "win32")("should-run.sh", () => {
  it("a pull request always runs", () => expect(decide({ EVENT: "pull_request" })).toBe("run=true"));
  it("a direct push to main (no PR) runs", () => expect(decide({})).toBe("run=true"));
  it("an unreadable PR head runs", () => expect(decide({ S_PR: "1052" })).toBe("run=true"));
  it("an unreadable main tree runs", () => expect(decide({ ...SAME, S_MAIN_TREE: "", S_GREEN: "1" })).toBe("run=true"));
  it("different trees (the PR was behind main) run", () => expect(decide({ ...SAME, S_PR_TREE: "T2", S_GREEN: "5" })).toBe("run=true"));
  it("same tree without a green run runs", () => expect(decide({ ...SAME, S_GREEN: "0" })).toBe("run=true"));
  it("garbage instead of a count runs", () => expect(decide({ ...SAME, S_GREEN: "abc" })).toBe("run=true"));
  it("the API being down runs", () => expect(decide({ ...SAME, S_GREEN: "1", GH_MODE: "down" })).toBe("run=true"));
  it("the ONLY skip: same tree and a green run", () => expect(decide({ ...SAME, S_GREEN: "1" })).toBe("run=false"));
});
