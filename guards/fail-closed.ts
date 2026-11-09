/**
 * fail-closed: readers of private data return nothing when something goes wrong.
 *
 * "Fail open" is the quiet kind of leak: the visibility lookup times out, the
 * code falls back to "visible", and a hidden profile shows up in a public list.
 * No test with a healthy mock notices. Two checks close the class:
 *
 *   readerGuard        (static) every file that reads a sensitive source applies
 *                      the visibility filter or calls the shared helper, or sits
 *                      in the allowlist with a reason. A new reader that forgot
 *                      the rule fails the build the day it is written.
 *
 *   failClosedGuard    (runtime) the reader is run against a data source that
 *                      throws, rejects, returns an error or returns nothing, and
 *                      must answer with its empty value every time.
 *
 * To keep a scope away from private fields altogether ("the public profile
 * module never reads email, phone or last_seen"), use text-guard with one rule
 * per field family.
 */
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { lineAt, lineText, readSources, resolveRoot, type GuardReport, type ListOptions, type Violation } from "./core";
import { plantedViolations } from "./expect-red";
import { guardSuite } from "./suite";

// ---------------------------------------------------------------------------
// Static: every reader decides
// ---------------------------------------------------------------------------

export interface ReaderGuardOptions extends ListOptions {
  name: string;
  /** Directory to scan. Relative paths resolve against the current directory. */
  root: string;
  /** How code reads the sensitive source, e.g. /\.from\(\s*["']profiles["']\s*\)/. */
  reads: RegExp;
  /** What makes a read safe: the filter, or a call to the shared helper. Any one is enough. */
  mustApply: RegExp | RegExp[];
  /**
   * Where `mustApply` must appear:
   *   "chain" (default) in the same statement as the read, up to the next ";";
   *   "file"  anywhere in the file (when reads go through a local helper).
   */
  scope?: "chain" | "file";
  /** Only statements matching this count as readers, e.g. reads filtered by another person's id. */
  when?: RegExp;
  /** The safe form in words, for the failure message. */
  requirement: string;
  /** Readers that need no filter: path from the root → reason. */
  allow?: Record<string, string>;
  /** Fewer readers than this means the pattern stopped matching. Default: 1. */
  minReaders?: number;
  hint?: string;
}

/** The statement starting at `index`: up to the next ";" or 40 lines, whichever comes first. */
function statementAt(code: string, index: number): string {
  const rest = code.slice(index);
  const semicolon = rest.indexOf(";");
  const statement = semicolon >= 0 ? rest.slice(0, semicolon) : rest;
  return statement.split("\n").slice(0, 40).join("\n");
}

function anyMatch(patterns: RegExp | RegExp[], text: string): boolean {
  return (Array.isArray(patterns) ? patterns : [patterns]).some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Finds the readers and the ones that skip the rule. Pure: no Vitest. */
export function scanReaders(options: ReaderGuardOptions): GuardReport & { readers: string[] } {
  for (const [file, reason] of Object.entries(options.allow ?? {})) {
    if (!reason.trim()) throw new Error(`allowlist entry "${file}" has no reason`);
  }
  const root = resolveRoot(options.root);
  const reads = new RegExp(options.reads.source, options.reads.flags.includes("g") ? options.reads.flags : `${options.reads.flags}g`);
  const allow = options.allow ?? {};
  const violations: Violation[] = [];
  const readers = new Set<string>();

  for (const file of readSources(root, options)) {
    for (const m of file.code.matchAll(reads)) {
      const index = m.index ?? 0;
      const statement = statementAt(file.code, index);
      if (options.when && !anyMatch(options.when, statement)) continue;
      readers.add(file.rel);
      if (file.rel in allow) continue;
      const safe = options.scope === "file" ? anyMatch(options.mustApply, file.code) : anyMatch(options.mustApply, statement);
      if (safe) continue;
      const line = lineAt(file.code, index);
      violations.push({
        file: file.rel,
        line,
        rule: "reader",
        message: `reads the source without ${options.requirement}`,
        snippet: lineText(file.text, line),
      });
    }
  }

  const list = [...readers].sort();
  const stale = Object.keys(allow)
    .filter((f) => !readers.has(f))
    .map((f) => `${f}: no longer reads the source, drop the exemption`);
  return { root, scanned: list, readers: list, violations, stale };
}

/** Registers the static guard as a Vitest suite and returns the report. */
export function readerGuard(options: ReaderGuardOptions): GuardReport {
  return guardSuite({
    name: options.name,
    scan: () => scanReaders(options),
    ruleTitle: `every reader applies the rule (${options.requirement})`,
    hint:
      options.hint ??
      `apply ${options.requirement}, or add the file to \`allow\` with the reason the unfiltered read is safe there.`,
    minFiles: options.minReaders,
    staleTitle: "every exemption still points at a reader",
  });
}

// ---------------------------------------------------------------------------
// Runtime: the reader under failure
// ---------------------------------------------------------------------------

/** A stand-in for the reader's data source, in whatever shape the reader calls. */
export type FailingSource = (...args: never[]) => unknown;

/**
 * Failure modes for a source shaped like most database clients: a function
 * that resolves to `{ data, error }`. Readers with another shape pass their own.
 */
export const STANDARD_FAILURES: Record<string, FailingSource> = {
  "throws synchronously": () => {
    throw new Error("connection reset");
  },
  rejects: () => Promise.reject(new Error("statement timeout")),
  "returns an error result": async () => ({ data: null, error: { message: "permission denied" } }),
  "returns neither data nor error": async () => ({ data: null, error: null }),
  "returns undefined": async () => undefined,
};

export interface FailClosedOptions<T> {
  name: string;
  /** Runs the reader with the given source. */
  read: (source: FailingSource) => Promise<T> | T;
  /** What "nothing" is for this reader: [], null, { items: [] }. */
  empty: T;
  /** Failure modes to try. Default: STANDARD_FAILURES. */
  failures?: Record<string, FailingSource>;
  /** Count a thrown error as closed too (the caller shows an error, nothing leaks). Default: false. */
  allowThrow?: boolean;
}

export interface Attempt<T> {
  /** True when the reader returned its empty value, or threw while `allowThrow` is set. */
  closed: boolean;
  result?: T;
  error?: unknown;
}

/** Runs the reader once against a failing source. Pure: no assertions. */
export async function attempt<T>(options: FailClosedOptions<T>, source: FailingSource): Promise<Attempt<T>> {
  try {
    const result = await options.read(source);
    return { closed: isDeepStrictEqual(result, options.empty), result };
  } catch (error) {
    return { closed: options.allowThrow === true, error };
  }
}

/**
 * One test per failure mode: the reader must return its empty value.
 * Inside expectRed(), the planted modes are the ones where the demo reader
 * leaks; their tests pass only if it really does.
 */
export function failClosedGuard<T>(options: FailClosedOptions<T>): void {
  const failures = options.failures ?? STANDARD_FAILURES;
  const planted = plantedViolations();
  describe(options.name, () => {
    it("has failure modes to try", () => {
      expect(Object.keys(failures).length).toBeGreaterThan(0);
      const unknown = (planted ?? []).filter((p) => !Object.keys(failures).some((mode) => mode.includes(p)));
      expect(unknown, "planted modes that match no failure mode").toEqual([]);
    });
    for (const [mode, source] of Object.entries(failures)) {
      const leaksOnPurpose = planted?.some((p) => mode.includes(p)) ?? false;
      const title = `returns nothing when the source ${mode}`;
      it(leaksOnPurpose ? `${title} (expected red: demo)` : title, async () => {
        const outcome = await attempt(options, source);
        if (leaksOnPurpose) {
          expect(outcome.closed, "the demo reader was supposed to leak in this mode").toBe(false);
          return;
        }
        if (outcome.error !== undefined && !options.allowThrow) {
          throw new Error(`the reader threw instead of returning its empty value: ${String(outcome.error)}`);
        }
        expect(outcome.result, "the reader must fail closed: on any failure it returns nothing").toEqual(options.empty);
      });
    }
  });
}
