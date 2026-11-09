/**
 * The three tests every guard registers, so all guards fail the same way:
 *
 *   1. it sees the files it guards (an empty scan is a broken guard, not a pass);
 *   2. the rule holds (the one assertion that matters);
 *   3. its allowlist or budget has no dead entries (exemptions do not pile up).
 */
import { describe, expect, it } from "vitest";
import type { GuardReport } from "./core";
import { assertViolations, plantedViolations } from "./expect-red";

export interface SuiteOptions {
  /** describe() title: the rule as a sentence. */
  name: string;
  /** Scans the tree. Runs once, while Vitest collects the tests. */
  scan: () => GuardReport;
  /** Title of the rule test. */
  ruleTitle: string;
  /** Shown when the rule test fails: what to do instead. */
  hint: string;
  /** Fewer scanned files than this means the guard is looking at the wrong place. */
  minFiles?: number | undefined;
  /** Files that must be in the scan, as paths from the root. */
  mustSee?: string[] | undefined;
  /** Title and hint of the dead-entries test. */
  staleTitle?: string;
  staleHint?: string;
}

/**
 * Why a scan cannot be trusted, if it cannot: too few files, or files it must
 * see are missing. An empty list means the scan looked where it should.
 */
export function coverageProblems(report: GuardReport, minFiles = 1, mustSee: string[] = []): string[] {
  const problems: string[] = [];
  if (report.scanned.length < minFiles) {
    problems.push(`scanned ${report.scanned.length} file(s), expected at least ${minFiles}: check the root and the filters`);
  }
  for (const file of mustSee.filter((f) => !report.scanned.includes(f))) problems.push(`must see ${file}, but it is not in the scan`);
  return problems;
}

export function guardSuite(options: SuiteOptions): GuardReport {
  const planted = plantedViolations();
  const report = options.scan();
  const minFiles = options.minFiles ?? 1;

  describe(options.name, () => {
    it(`sees the files it guards (${report.scanned.length} scanned)`, () => {
      expect(
        coverageProblems(report, minFiles, options.mustSee),
        "a guard that scans the wrong place passes for nothing: fix its root or filters before trusting a green run",
      ).toEqual([]);
    });

    it(planted ? `${options.ruleTitle} (expected red: demo)` : options.ruleTitle, () => {
      assertViolations(report.violations, planted, options.hint, options.name);
    });

    it(options.staleTitle ?? "the allowlist has no dead entries", () => {
      expect(
        report.stale,
        options.staleHint ?? "these entries no longer match anything: delete them so the allowlist keeps meaning something",
      ).toEqual([]);
    });
  });

  return report;
}
