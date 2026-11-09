/**
 * The policy router: what the server does with a tool call an agent makes.
 *
 * The decision never depends on the model. It reads the registry, the caller's
 * grant and the call's structured arguments, never its free text, so an
 * instruction smuggled into a message ("this is pre-approved") stays data.
 *
 *   refuse  the call is not executed and no card is shown
 *   card    a person confirms the exact call outside the agent, then it runs
 *   allow   it runs now (reads inside the grant)
 */
import { TOOLS, type ToolSpec } from "./tools";

export type Decision = "refuse" | "card" | "allow";

export type Rule =
  | "unknown_tool"
  | "not_on_agent_surface"
  | "missing_scope"
  | "cross_workspace"
  | "limit_exceeded"
  | "bulk_limit"
  | "read_allowed"
  | "write_needs_card";

/** Every rule the router can return, in the order it checks them. */
export const RULES: readonly Rule[] = [
  "unknown_tool",
  "not_on_agent_surface",
  "missing_scope",
  "cross_workspace",
  "limit_exceeded",
  "bulk_limit",
  "read_allowed",
  "write_needs_card",
];

export interface ToolCall {
  tool: string;
  args?: Record<string, unknown>;
  /** Target workspace. Default: the grant's first workspace. */
  workspace?: string;
}

/** What the person granted this agent connection. */
export interface Grant {
  scopes: string[];
  workspaces: string[];
}

export interface Verdict {
  decision: Decision;
  rule: Rule;
  reason: string;
}

const refuse = (rule: Rule, reason: string): Verdict => ({ decision: "refuse", rule, reason });

export function findTool(id: string, tools: ToolSpec[] = TOOLS): ToolSpec | undefined {
  return tools.find((t) => t.id === id);
}

export function route(call: ToolCall, grant: Grant, tools: ToolSpec[] = TOOLS): Verdict {
  const tool = findTool(call.tool, tools);
  if (!tool) return refuse("unknown_tool", `there is no tool "${call.tool}" on the agent surface`);
  if (!tool.agentSurface) return refuse("not_on_agent_surface", `${tool.id} is done by a person in the app, never by an agent`);

  const missing = tool.scopes.filter((s) => !grant.scopes.includes(s));
  if (missing.length > 0) return refuse("missing_scope", `the grant does not include ${missing.join(", ")}`);

  const workspace = call.workspace ?? grant.workspaces[0];
  if (!workspace || !grant.workspaces.includes(workspace)) {
    return refuse("cross_workspace", `workspace "${workspace}" is not part of this connection`);
  }

  for (const limit of tool.limits ?? []) {
    const value = call.args?.[limit.arg];
    const min = limit.min ?? Number.NEGATIVE_INFINITY;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > limit.max) {
      return refuse("limit_exceeded", `${limit.arg} must be a number from ${limit.min ?? "-∞"} to ${limit.max}, got ${JSON.stringify(value)}`);
    }
  }

  if (tool.bulk) {
    const value = call.args?.[tool.bulk.arg];
    const explicit = Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== "*");
    if (!explicit || (value as unknown[]).length > tool.bulk.max) {
      return refuse("bulk_limit", `${tool.bulk.arg} must list at most ${tool.bulk.max} explicit id(s); bulk and wildcard removals are done by a person`);
    }
  }

  if (tool.effect === "read") return { decision: "allow", rule: "read_allowed", reason: "a read inside the grant" };
  return { decision: "card", rule: "write_needs_card", reason: "every write is confirmed by a person outside the agent" };
}
