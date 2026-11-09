#!/usr/bin/env node
/**
 * sync-plugin.mjs: copies the files the setup skill installs into the plugin.
 *
 *   npm run plugin:sync
 *
 * WHY. `/plugin install` copies only the plugin's own folder to the user's
 * machine, so the setup skill cannot read guards/, ci/ or agent/ from this
 * repository. The repository root cannot be the plugin either: Claude Code
 * installs the dependencies of a plugin whose root holds a package.json and a
 * lockfile, which would put every dev dependency of this repository on the
 * user's machine. So the plugin carries a copy of exactly the files the skill
 * installs, and plugin.test.ts fails as soon as the copy drifts from its source.
 *
 * WHAT. Every top-level file of guards/ except tests (the set the README's
 * rsync copies), plus the CI and agent templates the skill installs. A copy
 * whose source is gone is deleted. The executable bit is kept.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Where the copy lives, as a path from the repository root. */
export const HARNESS_COPY = "plugins/mainstay/skills/setup/harness";

/** What the skill installs besides the guard helpers. */
const TEMPLATES = ["ci/guard-first.yml", "ci/should-run.sh", "agent/CLAUDE.md.template", "agent/pre-push.sh", "agent/PR_CHECKLIST.md"];

/** Every file the copy must hold, as sorted paths from the repository root. */
export function harnessFiles(root) {
  const guards = readdirSync(join(root, "guards"))
    .filter((name) => statSync(join(root, "guards", name)).isFile() && !name.endsWith(".test.ts"))
    .map((name) => `guards/${name}`);
  return [...guards, ...TEMPLATES].sort();
}

/** Every file under a folder, as sorted paths from it with forward slashes. */
export function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

const executable = (path) => (statSync(path).mode & 0o111) !== 0;

/** True when the copy has the source's bytes and executable bit. */
export function sameFile(source, copy) {
  return existsSync(copy) && readFileSync(source).equals(readFileSync(copy)) && executable(source) === executable(copy);
}

/** Brings the copy in line with its sources. Returns what it copied and what it deleted. */
export function syncPlugin(root) {
  const target = join(root, HARNESS_COPY);
  const wanted = harnessFiles(root);
  const copied = [];
  for (const rel of wanted) {
    const source = join(root, rel);
    const copy = join(target, rel);
    if (sameFile(source, copy)) continue;
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(source, copy);
    chmodSync(copy, statSync(source).mode & 0o777);
    copied.push(rel);
  }
  const removed = filesUnder(target).filter((rel) => !wanted.includes(rel));
  for (const rel of removed) rmSync(join(target, rel));
  return { copied, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { copied, removed } = syncPlugin(root);
  for (const rel of copied) console.log(`copied   ${rel}`);
  for (const rel of removed) console.log(`deleted  ${HARNESS_COPY}/${rel}`);
  console.log(copied.length + removed.length === 0 ? "The plugin's copy is up to date." : `Updated ${HARNESS_COPY}.`);
}
