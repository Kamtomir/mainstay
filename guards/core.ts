/**
 * Shared plumbing for source guards: walk a tree, blank out comments without
 * moving line numbers, and describe violations so a reviewer knows where to look.
 *
 * Nothing here depends on Vitest, so the same functions work in a script, a
 * pre-push hook or a REPL.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** A path test: a regular expression or a predicate over the path from the root. */
export type Matcher = RegExp | ((rel: string) => boolean);

export interface Violation {
  /** Path from the guard's root, with forward slashes. */
  file: string;
  /** 1-based line, when the guard can point at one. */
  line?: number;
  /** Which rule fired. */
  rule?: string;
  /** What is wrong and what to do instead. */
  message: string;
  /** The offending line, trimmed, so the failure reads without opening the file. */
  snippet?: string;
}

/** What every guard returns before any assertion runs. */
export interface GuardReport {
  /** Absolute root the paths are relative to. */
  root: string;
  /** Files the guard looked at, as paths from the root. */
  scanned: string[];
  violations: Violation[];
  /** Allowlist or budget entries that no longer apply (dead exemptions). */
  stale: string[];
}

export interface SourceFile {
  /** Path from the root, forward slashes. */
  rel: string;
  /** Absolute path. */
  path: string;
  /** The file as written. */
  text: string;
  /** The file with comments blanked out; line numbers unchanged. */
  code: string;
}

/** JavaScript and TypeScript sources: .js .jsx .ts .tsx .mjs .cjs .mts .cts */
export const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** Test files are usually excluded: they quote the very patterns a guard forbids. */
export const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:(?:^|\/)__tests__\/)/;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "out",
]);

export interface ListOptions {
  /** Which files to keep. Default: JavaScript and TypeScript sources. */
  include?: Matcher;
  /** Which files to drop, after `include`. */
  exclude?: Matcher;
  /** Keep test files too. Default: false. */
  includeTests?: boolean;
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** A root given as a relative path is resolved against the current directory. */
export function resolveRoot(root: string): string {
  return isAbsolute(root) ? root : resolve(process.cwd(), root);
}

export function matches(matcher: Matcher | undefined, rel: string): boolean {
  if (!matcher) return false;
  if (typeof matcher === "function") return matcher(rel);
  matcher.lastIndex = 0;
  return matcher.test(rel);
}

/** Every file under the root that passes the filters, as sorted paths from the root. */
export function listFiles(root: string, options: ListOptions = {}): string[] {
  const base = resolveRoot(root);
  if (!existsSync(base)) throw new Error(`guard root does not exist: ${base}`);
  const include = options.include ?? SOURCE_FILE;
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!IGNORED_DIRS.has(name)) walk(full);
        continue;
      }
      const rel = toPosix(relative(base, full));
      if (!matches(include, rel)) continue;
      if (!options.includeTests && TEST_FILE.test(rel)) continue;
      if (matches(options.exclude, rel)) continue;
      out.push(rel);
    }
  };
  walk(base);
  return out.sort();
}

/** Files with their text and their comment-free code. */
export function readSources(root: string, options: ListOptions = {}): SourceFile[] {
  const base = resolveRoot(root);
  return listFiles(base, options).map((rel) => {
    const path = join(base, rel);
    const text = readFileSync(path, "utf8");
    return { rel, path, text, code: stripComments(text) };
  });
}

/** 1-based line number of a character offset. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** The trimmed text of a 1-based line, cut to a readable length. */
export function lineText(text: string, line: number, max = 120): string {
  const value = (text.split("\n")[line - 1] ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** One line per violation: `file:line [rule] message — "snippet"`. */
export function formatViolation(v: Violation): string {
  const where = v.line ? `${v.file}:${v.line}` : v.file;
  const rule = v.rule ? ` [${v.rule}]` : "";
  const snippet = v.snippet ? ` — "${v.snippet}"` : "";
  return `${where}${rule} ${v.message}${snippet}`;
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

/** After these characters a `/` starts a regular expression, not a division. */
const REGEX_AFTER_CHAR = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
/** After these words, too: `return /x/.test(s)`. */
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

function skipString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (c === "\n") return i; // unterminated: stop at the line end
    i++;
  }
  return src.length;
}

function skipTemplate(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      i = skipTemplateExpression(src, i + 2);
      continue;
    }
    i++;
  }
  return src.length;
}

function skipTemplateExpression(src: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i, c);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return i + 1;
    i++;
  }
  return src.length;
}

/** End of a regex literal starting at `start`, or -1 when it is not one. */
function skipRegex(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") return -1;
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < src.length && /[a-z]/i.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Blanks out `//` and `/* *\/` comments (JSX `{/* *\/}` included) and keeps
 * every newline, so line numbers in the result match the original. Strings,
 * template literals and regex literals are kept as written: a URL in a string
 * is not a comment, and a guard looking for a regex must still see it.
 *
 * Limits: JSX text that contains `//` is treated as a comment, and comments
 * inside `${…}` of a template literal are kept. Both only ever blank text or
 * keep a comment; neither hides code.
 */
export function stripComments(src: string): string {
  let out = "";
  let prevChar = "";
  let prevWord = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const end = skipString(src, i, c);
      out += src.slice(i, end);
      i = end;
      prevChar = c;
      prevWord = "";
      continue;
    }
    if (c === "`") {
      const end = skipTemplate(src, i);
      out += src.slice(i, end);
      i = end;
      prevChar = c;
      prevWord = "";
      continue;
    }
    if (c === "/" && (REGEX_AFTER_CHAR.has(prevChar) || REGEX_AFTER_WORD.has(prevWord))) {
      const end = skipRegex(src, i);
      if (end > 0) {
        out += src.slice(i, end);
        i = end;
        prevChar = "/";
        prevWord = "";
        continue;
      }
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < src.length && IDENT_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      out += word;
      prevChar = word[word.length - 1];
      prevWord = word;
      i = j;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) {
      prevChar = c;
      prevWord = "";
    }
    i++;
  }
  return out;
}
