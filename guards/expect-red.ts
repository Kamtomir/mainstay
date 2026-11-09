/**
 * Demo support: point a real guard at code that breaks its rule on purpose and
 * keep the overall test run green.
 *
 * Inside `expectRed()`, a guard's "no violations" test is inverted: it passes
 * only when the guard reports exactly the planted violations. That proves the
 * guard fails for the right reason. A bare `it.fails` would not: any crash, a
 * typo or a wrong path would pass it too.
 *
 * `MAINSTAY_SHOW_RED=1` (that is what `npm run red` sets) turns the inversion
 * off, so the same tests fail the way they would in a real repository. The
 * READMEs quote that output.
 *
 * In your own repository you never need this file: a guard there must be green.
 */
import { expect } from "vitest";
import { formatViolation, type Violation } from "./core";

let planted: readonly string[] | null = null;

/**
 * Registers the guards created inside `register` as demos. Each planted entry
 * is a substring of one expected violation line, usually `file:line`.
 */
export function expectRed(violations: readonly string[], register: () => void): void {
  if (violations.length === 0) throw new Error("expectRed() needs at least one planted violation");
  const previous = planted;
  planted = violations;
  try {
    register();
  } finally {
    planted = previous;
  }
}

/** Planted violations of the guard being registered, or null for a real guard. */
export function plantedViolations(): readonly string[] | null {
  return process.env.MAINSTAY_SHOW_RED === "1" ? null : planted;
}

/** Thrown by a guard whose rule is broken. The message is the whole report. */
export class GuardViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardViolation";
    // The interesting location is the list of files, not this helper's frame.
    this.stack = `${this.name}: ${message}`;
  }
}

/** The failure text: one violation per line, the offending code under it, then what to do. */
export function describeViolations(title: string, violations: Violation[], hint: string): string {
  const lines = violations.map((v) => {
    const where = v.line ? `${v.file}:${v.line}` : v.file;
    const rule = v.rule ? `  [${v.rule}]` : "";
    const code = v.snippet ? `\n        ${v.snippet}` : "";
    return `  ${where}${rule}  ${v.message}${code}`;
  });
  const count = violations.length === 1 ? "1 violation" : `${violations.length} violations`;
  return `${count}: ${title}\n\n${lines.join("\n")}\n\nWhat to do: ${hint}`;
}

/**
 * The assertion every guard ends with. A real guard: no violations at all.
 * A demo: every planted entry matches a reported line and every reported line
 * matches a planted entry.
 */
export function assertViolations(
  violations: Violation[],
  expected: readonly string[] | null,
  hint: string,
  title = "guard",
): void {
  if (!expected) {
    if (violations.length > 0) throw new GuardViolation(describeViolations(title, violations, hint));
    return;
  }
  const found = violations.map(formatViolation);
  const missing = expected.filter((p) => !found.some((line) => line.includes(p)));
  const unexpected = found.filter((line) => !expected.some((p) => line.includes(p)));
  expect(
    { missing, unexpected },
    "the demo must fail for exactly the planted reasons (MAINSTAY_SHOW_RED=1 shows the real failure)",
  ).toEqual({ missing: [], unexpected: [] });
}
