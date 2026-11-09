/**
 * bundle-guard: forbidden syntax in modules that ship to the browser.
 *
 * Some code is fine on the server and fatal on a client. A regex lookbehind
 * `(?<=…)` parses on Node and in modern browsers, but Safari before 16.4 rejects
 * the whole file: one regex in a shared helper takes down every chunk that
 * imports it, on every iPhone that stayed on iOS 15. Bundlers do not rewrite it.
 *
 * The guard starts from client entry modules ("use client" by default), walks
 * their imports inside the source root, and checks every module it reaches.
 * A server-only module may keep its lookbehind: it is never reached.
 *
 *   bundleGuard({
 *     name: "client bundles contain no regex lookbehind",
 *     root: "src",
 *     aliases: { "@/": "" },
 *     mustReach: ["lib/format.ts"],
 *   });
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { lineAt, lineText, readSources, resolveRoot, toPosix, type GuardReport, type ListOptions, type SourceFile, type Violation } from "./core";
import { guardSuite } from "./suite";

export interface BundleRule {
  id: string;
  pattern: RegExp;
  message: string;
}

/** `(?<=` and `(?<!`. A named group `(?<name>…)` is fine: Safari has had it since 11.1. */
export const LOOKBEHIND: BundleRule = {
  id: "regex-lookbehind",
  pattern: /\(\?<[=!]/,
  message: "regex lookbehind: Safari before 16.4 cannot parse the file and the whole chunk fails to load",
};

/** A server secret read in client code is either undefined or, worse, inlined into the bundle. */
export const SERVER_ENV: BundleRule = {
  id: "server-env",
  pattern: /\bprocess\.env\.(?!NODE_ENV\b|NEXT_PUBLIC_)[A-Z][A-Z0-9_]*/,
  message: "server environment variable in client code: it is undefined in the browser, or inlined into the bundle",
};

/** Node built-ins do not exist in the browser. */
export const NODE_BUILTIN: BundleRule = {
  id: "node-builtin",
  pattern: /\bfrom\s+["']node:|\brequire\(\s*["'](?:node:)?(?:fs|child_process|net|tls|worker_threads)["']\s*\)/,
  message: "Node built-in in client code: it does not exist in the browser",
};

export interface BundleGuardOptions extends Omit<ListOptions, "include"> {
  name: string;
  /** Source root. Relative paths resolve against the current directory. */
  root: string;
  /** Which modules start a client bundle. Default: a "use client" directive at the top of the file. */
  isEntry?: (rel: string, text: string) => boolean;
  /** Import prefixes that point into the root: { "@/": "" } maps "@/lib/x" to "<root>/lib/x". */
  aliases?: Record<string, string>;
  /** What must not reach the client. Default: [LOOKBEHIND]. */
  forbid?: BundleRule[];
  /** Modules exempt from the rule: path from the root → reason. */
  allow?: Record<string, string>;
  /** The walk must reach at least this many modules. Default: 1. */
  minModules?: number;
  /** Modules that must be reached; protects the guard against a broken import parser. */
  mustReach?: string[];
  hint?: string;
}

/** A directive in the first statement; only comments may come before it. */
const CLIENT_DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

export function isClientEntry(_rel: string, text: string): boolean {
  return CLIENT_DIRECTIVE.test(text);
}

/** Import specifiers of a module, minus type-only imports (the compiler erases them). */
export function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (m[2]) continue;
    const named = /^\{([\s\S]*)\}$/.exec((m[3] ?? "").trim());
    const names = named ? (named[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (names.length > 0 && names.every((s) => s.startsWith("type "))) continue;
    if (m[4]) specs.push(m[4]);
  }
  for (const m of code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) if (m[1]) specs.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) if (m[1]) specs.push(m[1]);
  return specs;
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function resolveImport(spec: string, from: string, root: string, aliases: Record<string, string>): string | null {
  let base: string | null = null;
  for (const [prefix, target] of Object.entries(aliases)) {
    if (spec.startsWith(prefix)) {
      base = join(root, target, spec.slice(prefix.length));
      break;
    }
  }
  if (!base && spec.startsWith(".")) base = resolve(dirname(from), spec);
  if (!base) return null; // a package: not followed
  // TypeScript lets "./x.js" mean "./x.ts".
  const bases = /\.jsx?$/.test(base) ? [base, base.replace(/\.js(x?)$/, ".ts$1")] : [base];
  for (const b of bases) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${b}${suffix}`;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

/** Walks the client graph and checks every module it reaches. Pure: no Vitest. */
export function scanBundle(options: BundleGuardOptions): GuardReport {
  for (const [file, reason] of Object.entries(options.allow ?? {})) {
    if (!reason.trim()) throw new Error(`allowlist entry "${file}" has no reason`);
  }
  const root = resolveRoot(options.root);
  const isEntry = options.isEntry ?? isClientEntry;
  const aliases = options.aliases ?? {};
  const forbid = options.forbid ?? [LOOKBEHIND];
  const sources = new Map<string, SourceFile>(readSources(root, options).map((f) => [f.path, f]));

  const queue = [...sources.values()].filter((f) => isEntry(f.rel, f.text)).map((f) => f.path);
  const reached = new Set<string>();
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (reached.has(path)) continue;
    const file = sources.get(path);
    if (!file) continue; // outside the filters (a test file, say)
    reached.add(path);
    for (const spec of importSpecifiers(file.code)) {
      const target = resolveImport(spec, path, root, aliases);
      if (target && !reached.has(target)) queue.push(target);
    }
  }

  const allow = options.allow ?? {};
  const usedAllow = new Set<string>();
  const violations: Violation[] = [];
  for (const path of reached) {
    const file = sources.get(path)!;
    for (const rule of forbid) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      for (const m of file.code.matchAll(re)) {
        if (file.rel in allow) {
          usedAllow.add(file.rel);
          continue;
        }
        const line = lineAt(file.code, m.index ?? 0);
        violations.push({ file: file.rel, line, rule: rule.id, message: rule.message, snippet: lineText(file.text, line) });
      }
    }
  }

  const scanned = [...reached].map((p) => toPosix(relative(root, p))).sort();
  const stale = Object.keys(allow)
    .filter((f) => !usedAllow.has(f))
    .map((f) => (scanned.includes(f) ? `${f}: clean now, drop the exemption` : `${f}: not in any client bundle`));
  violations.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { root, scanned, violations, stale };
}

/** Registers the guard as a Vitest suite and returns the report. */
export function bundleGuard(options: BundleGuardOptions): GuardReport {
  const forbid = options.forbid ?? [LOOKBEHIND];
  return guardSuite({
    name: options.name,
    scan: () => scanBundle(options),
    ruleTitle: `no client module contains ${forbid.map((r) => r.id).join(", ")}`,
    hint:
      options.hint ??
      "rewrite the code in a client-safe form, or stop importing the module from client code. A lookbehind becomes a capture group returned in the replacement: /(^|\\s)x/ with \"$1\".",
    minFiles: options.minModules,
    mustSee: options.mustReach,
  });
}
