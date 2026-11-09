/**
 * Ratchet: ad-hoc edition checks only go down.
 *
 * WHY. Behaviour that should reach every customer stayed behind scattered
 * `isEnterprise()`-style checks, because each one was the safe choice in the
 * moment and nobody decided it on purpose. In the reference deployment the fix
 * was a release registry the operator switches without a deploy, plus this
 * budget: the checks that remain are counted per file, by category.
 *
 * HOW. Counts `isEnterprise()` and `process.env.EDITION` in every file outside
 * flags/ (the registry is where they belong) and compares the count with the
 * budget below.
 *   - over budget: new debt. Use isFeatureOn(key), or raise the budget here
 *     with a comment; the reviewer sees the decision in this file's diff;
 *   - under budget: debt was paid down. Lower the budget so it stays paid;
 *   - a budget for a deleted file: remove the line.
 *
 * LIMITS. Counts text, so an alias (`const ent = isEnterprise`) is one match
 * and its calls are none. Keep the patterns to the forms the codebase uses.
 */
import { fileURLToPath } from "node:url";
import { expectRed } from "../../expect-red";
import { ratchet } from "../../ratchet";

const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url));
const PATTERNS = [/\bisEnterprise\(\)/g, /\bprocess\.env\.EDITION\b/g];

expectRed(["pages/settings.tsx", "emails/digest.ts"], () =>
  ratchet({
    name: "ad-hoc edition checks only go down (bad fixture)",
    root: fixture("bad"),
    patterns: PATTERNS,
    exempt: ["flags/"],
    budget: {
      // Isolation: money paths differ per edition on purpose.
      ISOLATION: { "billing/checkout.ts": 1 },
      // Debt: each line is a future registry flag.
      DEBT: { "pages/home.tsx": 2, "emails/digest.ts": 1 },
    },
    minFiles: 4,
  }),
);

ratchet({
  name: "ad-hoc edition checks only go down (good fixture)",
  root: fixture("good"),
  patterns: PATTERNS,
  exempt: ["flags/"],
  budget: {
    ISOLATION: { "billing/checkout.ts": 1 },
    DEBT: { "pages/home.tsx": 2 },
  },
  minFiles: 4,
});
