/**
 * surface-guard: every file of a surface does the required thing.
 *
 * A surface is a set of files that face the outside world in the same way: API
 * route handlers, webhook receivers, cron entry points, server actions. The rule
 * is a sentence: "every route under app/api checks the session", "every webhook
 * verifies its signature". Files join the surface by their path, so a route
 * added next month is checked without anyone remembering to add it.
 *
 * Two forms, usable together:
 *
 *   require   each surface file contains at least one of the patterns
 *             ("calls requireUser(" or "is wrapped in withAuth(").
 *   eachCall  each call of a function inside the surface passes something
 *             ("every rateLimit( call names its store").
 *
 *   surfaceGuard({
 *     name: "every API route checks the session",
 *     root: "app/api",
 *     files: /(^|\/)route\.ts$/,
 *     require: /\brequireUser\(/,
 *     allow: { "health/route.ts": "liveness probe: answers 200 and returns no data" },
 *   });
 */
import { lineAt, lineText, readSources, resolveRoot, type GuardReport, type ListOptions, type Matcher, type Violation } from "./core";
import { guardSuite } from "./suite";

export interface EachCallRule {
  /** The call to check, e.g. /\brateLimit\s*\(/. */
  call: RegExp;
  /** What the call's arguments must contain, e.g. /store:\s*["']global["']/. */
  mustInclude: RegExp;
  /** The requirement in words, for the failure message: 'passes { store: "global" }'. */
  requirement: string;
  /** The call is fine when this appears on its line or in the `contextLines` lines above. */
  unless?: RegExp;
  /** How far `unless` looks up. Default: 2 lines. */
  contextLines?: number;
}

export interface SurfaceGuardOptions extends Omit<ListOptions, "include"> {
  name: string;
  /** Directory to scan. Relative paths resolve against the current directory. */
  root: string;
  /** Which files under the root form the surface (path from the root). */
  files: Matcher;
  /** Each surface file must contain at least one of these (comments do not count). */
  require?: RegExp | RegExp[];
  /** The requirement in words for `require`, e.g. "calls requireUser(request)". */
  requirement?: string;
  /** Each call of a function in the surface must pass something. */
  eachCall?: EachCallRule;
  /** Files exempt from the rule: path from the root → reason. */
  allow?: Record<string, string>;
  minFiles?: number;
  mustSee?: string[];
  hint?: string;
}

/** Text of the call's argument list, from its "(" to the matching ")". */
function callArguments(code: string, from: number): string {
  const open = code.indexOf("(", from);
  if (open < 0) return "";
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < code.length && code[i] !== quote) i += code[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth === 0) return code.slice(open, i + 1);
    i++;
  }
  return code.slice(open);
}

function patterns(value: RegExp | RegExp[] | undefined): RegExp[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function testOnce(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

/** Checks the surface. Pure: no assertions, no Vitest. */
export function scanSurface(options: SurfaceGuardOptions): GuardReport {
  if (!options.require && !options.eachCall) throw new Error("surfaceGuard needs `require`, `eachCall`, or both");
  for (const [file, reason] of Object.entries(options.allow ?? {})) {
    if (!reason.trim()) throw new Error(`allowlist entry "${file}" has no reason`);
  }
  const root = resolveRoot(options.root);
  const files = readSources(root, { ...options, include: options.files });
  const required = patterns(options.require);
  const violations: Violation[] = [];
  const allow = options.allow ?? {};
  const usedAllow = new Set<string>();

  for (const file of files) {
    const fileViolations: Violation[] = [];

    if (required.length > 0 && !required.some((re) => testOnce(re, file.code))) {
      fileViolations.push({
        file: file.rel,
        rule: "require",
        message: `does not ${options.requirement ?? `match ${required.map((r) => r.source).join(" or ")}`}`,
      });
    }

    if (options.eachCall) {
      const rule = options.eachCall;
      const call = new RegExp(rule.call.source, rule.call.flags.includes("g") ? rule.call.flags : `${rule.call.flags}g`);
      const lines = file.code.split("\n");
      for (const m of file.code.matchAll(call)) {
        const index = m.index ?? 0;
        const line = lineAt(file.code, index);
        const args = callArguments(file.code, index);
        if (testOnce(rule.mustInclude, args)) continue;
        if (rule.unless) {
          const above = lines.slice(Math.max(0, line - 1 - (rule.contextLines ?? 2)), line).join("\n");
          if (testOnce(rule.unless, above)) continue;
        }
        fileViolations.push({
          file: file.rel,
          line,
          rule: "each-call",
          message: `call does not ${rule.requirement}`,
          snippet: lineText(file.text, line),
        });
      }
    }

    if (fileViolations.length > 0 && file.rel in allow) {
      usedAllow.add(file.rel);
      continue;
    }
    violations.push(...fileViolations);
  }

  const scanned = files.map((f) => f.rel);
  const stale = Object.keys(allow)
    .filter((file) => !usedAllow.has(file))
    .map((file) => (scanned.includes(file) ? `${file}: follows the rule now, drop the exemption` : `${file}: not part of the surface`));

  return { root, scanned, violations, stale };
}

/** Registers the guard as a Vitest suite and returns the report. */
export function surfaceGuard(options: SurfaceGuardOptions): GuardReport {
  const what = [options.requirement, options.eachCall?.requirement].filter(Boolean).join("; ");
  return guardSuite({
    name: options.name,
    scan: () => scanSurface(options),
    ruleTitle: what ? `every surface file follows the rule (${what})` : "every surface file follows the rule",
    hint:
      options.hint ??
      "make the file follow the rule, or add it to `allow` with the reason it is safe without it.",
    minFiles: options.minFiles,
    mustSee: options.mustSee,
  });
}
