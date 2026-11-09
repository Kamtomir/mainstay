/**
 * Guard: no regex lookbehind in modules that reach the browser.
 *
 * WHY. Safari before 16.4 does not support `(?<=…)` and `(?<!…)`. A regex
 * literal with one is a syntax error for the whole file, so the chunk does not
 * run at all: one helper breaks every screen that imports it. In-app browsers
 * on iOS use the system WebKit, and older iPhones stay on iOS 15. Bundlers do
 * not rewrite the syntax. In the reference deployment, a lookbehind in a shared
 * sanitizer took down the home screen for those users; the reports arrived
 * through the browser error intake, and this guard landed in the same PR.
 *
 * HOW. Start from every "use client" module, follow static, side-effect and
 * dynamic imports inside the source root (the `@/` alias and relative paths),
 * and check each reached module for `(?<=` and `(?<!`, in literals and in
 * strings passed to `new RegExp`. Type-only imports are skipped: the compiler
 * erases them. A server-only module may keep its lookbehind.
 *
 * IF IT FAILS. Turn the lookbehind into a group returned in the replacement:
 * `/(?<=\s)#x/` becomes `/(\s)#x/` with "$1". Or stop importing the module from
 * client code.
 *
 * LIMITS. Packages in node_modules are not followed.
 */
import { fileURLToPath } from "node:url";
import { expectRed } from "../../expect-red";
import { bundleGuard, LOOKBEHIND } from "../../bundle-guard";

const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url));

// Reaching these proves the import walk works: an alias import, a relative
// import and a dynamic import(). Without this, a broken parser would pass.
const mustReach = ["components/Search.tsx", "lib/highlight.ts", "lib/format.ts", "lib/dates.ts"];

expectRed(["lib/highlight.ts:2", "lib/dates.ts:2"], () =>
  bundleGuard({
    name: "client bundles contain no regex lookbehind (bad fixture)",
    root: fixture("bad"),
    aliases: { "@/": "" },
    forbid: [LOOKBEHIND],
    mustReach,
  }),
);

bundleGuard({
  name: "client bundles contain no regex lookbehind (good fixture)",
  root: fixture("good"),
  aliases: { "@/": "" },
  forbid: [LOOKBEHIND],
  mustReach,
});
