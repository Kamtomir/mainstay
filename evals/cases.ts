/**
 * Loads and validates an eval set in the refusals.yaml format. A malformed set
 * fails loudly: an eval that silently skips its cases is worse than none.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Decision, Grant, ToolCall } from "./reference/policy";

export interface EvalCase {
  id: string;
  ask: string;
  call: ToolCall;
  grant: Grant;
  expected: Decision;
  rule?: string;
  reason: string;
  twin?: string;
}

const DECISIONS: readonly Decision[] = ["refuse", "card", "allow"];

function fail(message: string): never {
  throw new Error(`eval set: ${message}`);
}

function asGrant(value: unknown, where: string): Grant {
  const g = value as Partial<Grant> | undefined;
  if (!g || !Array.isArray(g.scopes) || !Array.isArray(g.workspaces)) fail(`${where}: grant needs scopes[] and workspaces[]`);
  return { scopes: g.scopes.map(String), workspaces: g.workspaces.map(String) };
}

export function loadCases(path: string): EvalCase[] {
  const doc = parse(readFileSync(path, "utf8")) as { defaults?: { grant?: unknown }; cases?: unknown[] };
  if (!doc || !Array.isArray(doc.cases) || doc.cases.length === 0) fail("no cases");
  const defaultGrant = doc.defaults?.grant ? asGrant(doc.defaults.grant, "defaults") : undefined;
  const seen = new Set<string>();

  return doc.cases.map((raw, index) => {
    const c = raw as Record<string, unknown>;
    const where = typeof c.id === "string" ? c.id : `case #${index + 1}`;
    if (typeof c.id !== "string" || !/^[a-z0-9-]+$/.test(c.id)) fail(`${where}: id must be kebab-case`);
    if (seen.has(c.id)) fail(`${where}: duplicate id`);
    seen.add(c.id);
    if (typeof c.ask !== "string" || !c.ask.trim()) fail(`${where}: ask is required`);
    if (typeof c.reason !== "string" || !c.reason.trim()) fail(`${where}: reason is required`);
    if (!DECISIONS.includes(c.expected as Decision)) fail(`${where}: expected must be refuse, card or allow`);
    const call = c.call as ToolCall | undefined;
    if (!call || typeof call.tool !== "string") fail(`${where}: call.tool is required`);
    const grant = c.grant ? asGrant(c.grant, where) : defaultGrant;
    if (!grant) fail(`${where}: no grant and no defaults.grant`);
    if (c.expected === "refuse" && typeof c.twin !== "string") fail(`${where}: a refusal needs a twin`);
    return {
      id: c.id,
      ask: c.ask,
      call: { tool: call.tool, args: call.args ?? {}, workspace: call.workspace },
      grant,
      expected: c.expected as Decision,
      rule: typeof c.rule === "string" ? c.rule : undefined,
      reason: c.reason,
      twin: typeof c.twin === "string" ? c.twin : undefined,
    };
  });
}
