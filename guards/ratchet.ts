/**
 * ratchet: a per-file budget of known debt that can only go down.
 *
 * Some debt cannot be fixed in one PR but must stop growing today: ad-hoc
 * "if (edition === 'enterprise')" checks scattered around instead of a flag
 * registry, `as any` casts, `eslint-disable` lines, direct SQL outside the data
 * layer. The ratchet counts the pattern in every file and compares it with a
 * budget written in the test:
 *
 *   - a file over its budget fails: new debt needs a decision, visible in the
 *     diff of this budget, not a line buried in a 400-line PR;
 *   - a file under its budget fails too: someone paid the debt down, so the
 *     budget must follow, or the next PR could quietly spend it again;
 *   - a budget for a file that no longer exists fails: the list stays true.
 *
 * Budgets can be grouped by category, so the review says why the debt exists:
 *
 *   ratchet({
 *     name: "ad-hoc edition checks only go down",
 *     root: "src",
 *     patterns: [/\bisEnterprise\(\)/g, /process\.env\.EDITION\b/g],
 *     exempt: ["flags/"],
 *     budget: {
 *       ISOLATION: { "billing/checkout.ts": 1 },   // stays: money paths differ per edition
 *       DEBT: { "pages/home.tsx": 2 },             // to move into the flag registry
 *     },
 *   });
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readSources, resolveRoot, type GuardReport, type ListOptions, type Violation } from "./core";
import { guardSuite } from "./suite";

/** Flat { file: count } or grouped { CATEGORY: { file: count } }. */
export type Budget = Record<string, number> | Record<string, Record<string, number>>;

export interface RatchetOptions extends ListOptions {
  name: string;
  /** Directory to scan. Relative paths resolve against the current directory. */
  root: string;
  /** One match of any pattern is one unit of debt. Counted in code, comments blanked. */
  patterns: RegExp[];
  budget: Budget;
  /** Paths (prefixes or patterns) where the pattern is the module's job, e.g. the flag registry. */
  exempt?: (string | RegExp)[];
  /** The scan must see at least this many files. Default: 1. */
  minFiles?: number;
  /** What to do instead of raising the budget. */
  hint?: string;
}

/** Sums a flat or grouped budget into { file: count }. */
export function flattenBudget(budget: Budget): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, value] of Object.entries(budget as Record<string, number | Record<string, number>>)) {
    if (typeof value === "number") out.set(key, (out.get(key) ?? 0) + value);
    else for (const [file, n] of Object.entries(value)) out.set(file, (out.get(file) ?? 0) + n);
  }
  return out;
}

function isExempt(rel: string, exempt: RatchetOptions["exempt"]): boolean {
  return (exempt ?? []).some((e) => (typeof e === "string" ? rel.startsWith(e) : e.test(rel)));
}

export function countMatches(code: string, patterns: RegExp[]): number {
  return patterns.reduce((n, p) => {
    const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    return n + (code.match(re)?.length ?? 0);
  }, 0);
}

/** Counts the debt and compares it with the budget. Pure: no Vitest. */
export function scanRatchet(options: RatchetOptions): GuardReport & { actual: Map<string, number>; budget: Map<string, number> } {
  const root = resolveRoot(options.root);
  const files = readSources(root, options).filter((f) => !isExempt(f.rel, options.exempt));
  const actual = new Map<string, number>();
  for (const f of files) {
    const n = countMatches(f.code, options.patterns);
    if (n > 0) actual.set(f.rel, n);
  }
  const budget = flattenBudget(options.budget);
  const violations: Violation[] = [];

  for (const [file, n] of actual) {
    const allowed = budget.get(file) ?? 0;
    if (n > allowed) {
      violations.push({
        file,
        rule: "grew",
        message: `${n} found, budget ${allowed}: new debt. Use the sanctioned way, or raise the budget here with a comment saying why`,
      });
    }
  }
  for (const [file, allowed] of budget) {
    const n = actual.get(file) ?? 0;
    if (n < allowed && existsSync(join(root, file))) {
      violations.push({
        file,
        rule: "shrank",
        message:
          n === 0
            ? `0 found, budget ${allowed}: debt was paid down. Remove the file from the budget so it cannot come back`
            : `${n} found, budget ${allowed}: debt was paid down. Lower the budget to ${n} so it cannot come back`,
      });
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file));

  const stale = [...budget.keys()].filter((f) => !existsSync(join(root, f))).map((f) => `${f}: file no longer exists`);
  return { root, scanned: files.map((f) => f.rel), violations, stale, actual, budget };
}

/** Registers the ratchet as a Vitest suite and returns the report. */
export function ratchet(options: RatchetOptions): GuardReport {
  const total = [...flattenBudget(options.budget).values()].reduce((a, b) => a + b, 0);
  return guardSuite({
    name: options.name,
    scan: () => scanRatchet(options),
    ruleTitle: `every file is exactly at its budget (${total} known in total)`,
    hint:
      options.hint ??
      "grew: write it the sanctioned way instead, or raise that file's budget with a comment the reviewer can judge. shrank: lower the budget to the new count.",
    minFiles: options.minFiles,
    staleTitle: "the budget lists no deleted files",
    staleHint: "remove these files from the budget",
  });
}
