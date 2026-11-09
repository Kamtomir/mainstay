/**
 * Guard: readers of profiles fail closed.
 *
 * WHY. Visibility rules that live as a copy in every reader drift. In the
 * reference deployment, a rejected item stayed visible in a digest, a home feed
 * and a bot answer because 20 of the 42 readers of one table knew about its
 * status column. A second class is quieter still: the settings lookup fails,
 * the code falls back to "visible", and a hidden person shows up in a list.
 *
 * HOW. Two checks.
 *   1. readerGuard: every statement that reads `profiles` filters
 *      `visibility = "members"` (or goes through visibleProfiles()), or the
 *      file is exempt with a reason. A new reader that forgot is red on day one.
 *   2. failClosedGuard: the reader runs against a source that throws, rejects,
 *      returns an error, returns nothing or returns a row with no flag, and
 *      must return [] every time.
 *
 * IF IT FAILS. Filter in the query or call the helper. If the reader really
 * must see hidden rows (a moderation queue), exempt it with the reason. In the
 * reader itself: return the empty value on every failure path, and show a row
 * only on an explicit "yes".
 *
 * LIMITS. The static check reads one statement; a query assembled across
 * several statements is not seen.
 */
import { fileURLToPath } from "node:url";
import { expectRed } from "../../expect-red";
import { failClosedGuard, readerGuard, STANDARD_FAILURES } from "../../fail-closed";
import { listVisibleClosed, listVisibleOpen, type ProfileRow, type ProfileSource } from "./readers";

const root = fileURLToPath(new URL("./fixture/src", import.meta.url));

// 1. Static: every reader decides.
expectRed(["digest/weekly.ts:5"], () =>
  readerGuard({
    name: "every reader of profiles applies the visibility filter",
    root,
    reads: /\.from\(\s*["']profiles["']\s*\)/,
    mustApply: [/\.eq\(\s*["']visibility["']\s*,\s*["']members["']\s*\)/, /\bvisibleProfiles\(/],
    requirement: '.eq("visibility", "members") or visibleProfiles()',
    allow: {
      "admin/moderation.ts": "moderation queue: the team reviews reported profiles, hidden ones included",
    },
    minReaders: 3,
  }),
);

// 2. Runtime: the reader under failure.
const FAILURES = {
  ...STANDARD_FAILURES,
  "returns a row with no visibility flag": async () => ({ data: [{ id: "u9", name: "No flag" }], error: null }),
};
const lastGood: ProfileRow[] = [{ id: "u1", name: "Hid their profile yesterday", visibility: "members" }];

expectRed(["throws", "rejects", "error result", "neither data", "undefined", "no visibility flag"], () =>
  failClosedGuard({
    name: "the fail-open reader leaks on every failure (demo)",
    read: (source) => listVisibleOpen(source as ProfileSource, lastGood),
    empty: [],
    failures: FAILURES,
  }),
);

failClosedGuard({
  name: "the fail-closed reader returns nobody on any failure",
  read: (source) => listVisibleClosed(source as ProfileSource),
  empty: [],
  failures: FAILURES,
});
