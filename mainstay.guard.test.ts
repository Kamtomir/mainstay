/**
 * The harness guards itself with its own helpers.
 *
 *   1. Code and docs stay in English, so anyone can adopt them. The README's
 *      closing summary in Russian is the one exception.
 *   2. No invisible or bidirectional control characters in any file. They make
 *      code read differently from how it runs ("Trojan Source"). This rule is
 *      the incident-to-guard loop applied to the harness itself: while it was
 *      being written, a tool turned escape sequences in a regex into the real
 *      invisible characters. The fix and this guard landed together.
 *   3. The reference sanitizer stays client-safe: no regex lookbehind and no
 *      Node built-ins, because a screen may import it to preview exactly what
 *      the server stores.
 */
import { fileURLToPath } from "node:url";
import { bundleGuard, LOOKBEHIND, NODE_BUILTIN } from "./guards/bundle-guard";
import { textGuard } from "./guards/text-guard";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Zero-width, direction-override and isolate characters, plus the byte-order
 * mark. Built from code points so this file itself contains none of them.
 */
const INVISIBLE_RANGES: [number, number][] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("")}]`,
);

textGuard({
  name: "every file is plain English text",
  root: here("."),
  include: /\.(?:[cm]?[jt]sx?|sh|ya?ml|sql|md|template)$/,
  includeTests: true,
  keepComments: true,
  rules: [
    { id: "invisible", pattern: INVISIBLE, message: "invisible or bidirectional character: write it as an escape sequence" },
    { id: "cyrillic", pattern: /[\u0400-\u04FF]/, message: "Cyrillic text: write it in English" },
  ],
  allow: { "README.md": { reason: "the closing summary in Russian, by design", rules: ["cyrillic"] } },
  minFiles: 40,
  mustSee: ["guards/text-guard.ts", "evals/refusals.yaml", "ci/should-run.sh", "agent/CLAUDE.md.template"],
});

bundleGuard({
  name: "the reference sanitizer is client-safe",
  root: here("evals/reference"),
  isEntry: (rel) => rel === "sanitize.ts",
  forbid: [LOOKBEHIND, NODE_BUILTIN],
  mustReach: ["sanitize.ts"],
});
