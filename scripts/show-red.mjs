#!/usr/bin/env node
/**
 * npm run red [paths...]
 *
 * Runs the demo guards with the expected-red inversion switched off, so you see
 * the failures exactly as they would look in a real repository. This command is
 * meant to exit non-zero: the demos are red on purpose.
 *
 * Default: every test file with "examples" in its path (guards/examples and examples/).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// The CLI entry from vitest's own package.json "bin": works on every OS, no shell needed.
const require = createRequire(import.meta.url);
const pkgPath = require.resolve("vitest/package.json");
const vitest = join(dirname(pkgPath), require(pkgPath).bin.vitest);
const paths = process.argv.slice(2);
const targets = paths.length > 0 ? paths : ["examples"];

const result = spawnSync(process.execPath, [vitest, "run", ...targets], {
  stdio: "inherit",
  env: { ...process.env, MAINSTAY_SHOW_RED: "1" },
});
process.exit(result.status ?? 1);
