/**
 * text-guard: a source invariant written as grep + allowlist.
 *
 * Use it when the rule fits the sentence "this text never appears in that
 * code": `void db.from(` (a lazy query builder that never runs), a hard-coded
 * production host, a raw model id where a tier belongs, a private column in a
 * public module. Comments are blanked first: explaining a rule in words is
 * fine, breaking it in code is not.
 *
 * The allowlist is part of the rule. Every entry carries the reason a reviewer
 * reads in the diff, and an entry that no longer matches anything fails the
 * suite, so exemptions cannot pile up silently.
 *
 *   textGuard({
 *     name: "void never fires a lazy query builder",
 *     root: "src",
 *     rules: [{ id: "void-builder", pattern: /\bvoid\s+db\.from\(/, message: "await it or schedule it" }],
 *   });
 */
import { lineAt, lineText, readSources, resolveRoot, type GuardReport, type ListOptions, type Violation } from "./core";
import { guardSuite } from "./suite";

export interface TextRule {
  /** Short id shown in the failure, e.g. "void-builder". */
  id: string;
  /** What must not appear. Matched against code with comments blanked. */
  pattern: RegExp;
  /** What is wrong and what to write instead. */
  message: string;
}

export interface AllowEntry {
  /** Why this file may break the rule. Required: an exemption without a reason is a bug. */
  reason: string;
  /** Rule ids the exemption covers. Default: all rules. */
  rules?: string[];
}

export interface TextGuardOptions extends ListOptions {
  /** The rule as a sentence; becomes the describe() title. */
  name: string;
  /** Directory to scan. Relative paths resolve against the current directory. */
  root: string;
  rules: TextRule[];
  /** Files allowed to break a rule: path from the root → reason (or { reason, rules }). */
  allow?: Record<string, string | AllowEntry>;
  /** Match comments too. Default: false. */
  keepComments?: boolean;
  /** The scan must see at least this many files. Default: 1. */
  minFiles?: number;
  /** Files that must be in the scan, as paths from the root. */
  mustSee?: string[];
  /** What to do when it fails. */
  hint?: string;
}

function normalizeAllow(allow: TextGuardOptions["allow"]): Map<string, AllowEntry> {
  const out = new Map<string, AllowEntry>();
  for (const [file, entry] of Object.entries(allow ?? {})) {
    const value = typeof entry === "string" ? { reason: entry } : entry;
    if (!value.reason || !value.reason.trim()) {
      throw new Error(`allowlist entry "${file}" has no reason: say why this file may break the rule`);
    }
    out.set(file, value);
  }
  return out;
}

function globalCopy(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

/** Runs the rules over the tree. Pure: no assertions, no Vitest. */
export function scanText(options: TextGuardOptions): GuardReport {
  const root = resolveRoot(options.root);
  const allow = normalizeAllow(options.allow);
  const files = readSources(root, options);
  const violations: Violation[] = [];
  const usedAllow = new Set<string>();

  for (const file of files) {
    const body = options.keepComments ? file.text : file.code;
    for (const rule of options.rules) {
      const re = globalCopy(rule.pattern);
      for (const m of body.matchAll(re)) {
        const exemption = allow.get(file.rel);
        if (exemption && (!exemption.rules || exemption.rules.includes(rule.id))) {
          usedAllow.add(file.rel);
          continue;
        }
        const line = lineAt(body, m.index ?? 0);
        violations.push({ file: file.rel, line, rule: rule.id, message: rule.message, snippet: lineText(file.text, line) });
      }
    }
  }

  const scanned = files.map((f) => f.rel);
  const stale = [...allow.keys()]
    .filter((file) => !usedAllow.has(file))
    .map((file) => (scanned.includes(file) ? `${file}: no longer breaks the rule` : `${file}: not found under the root`));

  return { root, scanned, violations, stale };
}

/** Registers the guard as a Vitest suite and returns the report. */
export function textGuard(options: TextGuardOptions): GuardReport {
  return guardSuite({
    name: options.name,
    scan: () => scanText(options),
    ruleTitle: `no code breaks the rule (${options.rules.map((r) => r.id).join(", ")})`,
    hint:
      options.hint ??
      "fix the code, or add the file to `allow` with the reason a reviewer can check. Do not loosen the pattern to get green.",
    minFiles: options.minFiles,
    mustSee: options.mustSee,
  });
}

