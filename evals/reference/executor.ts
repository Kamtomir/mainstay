/**
 * The approval layer: the only checkpoint that does not depend on the model.
 *
 *   request()  what the agent calls. Reads run; writes come back as a card;
 *              refusals come back as a refusal.
 *   approve()  what the person's button calls, outside the agent (the app, a
 *              chat bot, an email link). A confirmation inside the agent's own
 *              chat does not count: the agent could fake it.
 *   execute()  runs an approved card. The approval is bound to the exact call
 *              it was shown for, works once, and the policy is checked again,
 *              so a limit lowered after the card was shown still wins.
 *
 * The card is built by the server from the real arguments, never from the
 * agent's description of them.
 */
import { createHash, randomUUID } from "node:crypto";
import { findTool, route, type Grant, type ToolCall, type Verdict } from "./policy";
import { TOOLS, type ToolSpec } from "./tools";

export interface Card {
  id: string;
  tool: string;
  workspace: string;
  /** The consequence with placeholders filled from the real arguments. */
  consequence: string;
  /** Free-text arguments, shown as quoted data. */
  untrusted: Record<string, string>;
  /** Fingerprint of the exact call the person is approving. */
  digest: string;
}

export interface Approval {
  cardId: string;
  digest: string;
  approvedBy: string;
}

export type RequestOutcome =
  | { status: "done"; result: unknown }
  | { status: "needs_approval"; card: Card }
  | { status: "refused"; verdict: Verdict };

export type ExecuteOutcome = { status: "done"; result: unknown } | { status: "refused"; reason: string };

export type Handler = (args: Record<string, unknown>, workspace: string) => Promise<unknown>;

/** Stable JSON: keys sorted, so the same call always has the same digest. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestOf(call: ToolCall, workspace: string): string {
  return createHash("sha256")
    .update(canonical({ tool: call.tool, workspace, args: call.args ?? {} }))
    .digest("hex");
}

/** Fills {arg} placeholders from the real arguments. Missing ones stay visible as {arg}. */
export function renderConsequence(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = args[name];
    if (value === undefined) return whole;
    return Array.isArray(value) ? value.join(", ") : String(value);
  });
}

export interface ExecutorOptions {
  grant: Grant;
  handlers: Record<string, Handler>;
  /** The registry, or a getter when it can change between the card and the click (a limit lowered, a tool switched off). */
  tools?: ToolSpec[] | (() => ToolSpec[]);
}

export function createExecutor(options: ExecutorOptions) {
  const registry = (): ToolSpec[] =>
    typeof options.tools === "function" ? options.tools() : (options.tools ?? TOOLS);
  const cards = new Map<string, Card>();
  const approvals = new Map<string, Approval>();
  const used = new Set<string>();

  const workspaceOf = (call: ToolCall, grant: Grant) => call.workspace ?? grant.workspaces[0];

  async function run(call: ToolCall, workspace: string): Promise<unknown> {
    const handler = options.handlers[call.tool];
    if (!handler) throw new Error(`no handler for ${call.tool}`);
    return handler(call.args ?? {}, workspace);
  }

  return {
    async request(call: ToolCall): Promise<RequestOutcome> {
      const tools = registry();
      const verdict = route(call, options.grant, tools);
      if (verdict.decision === "refuse") return { status: "refused", verdict };
      const workspace = workspaceOf(call, options.grant);
      if (verdict.decision === "allow") return { status: "done", result: await run(call, workspace) };

      const tool = findTool(call.tool, tools)!;
      const args = call.args ?? {};
      const untrusted: Record<string, string> = {};
      for (const name of tool.untrustedArgs ?? []) {
        if (typeof args[name] === "string") untrusted[name] = args[name] as string;
      }
      const card: Card = {
        id: randomUUID(),
        tool: tool.id,
        workspace,
        consequence: renderConsequence(tool.consequence ?? `Runs ${tool.id}.`, args),
        untrusted,
        digest: digestOf(call, workspace),
      };
      cards.set(card.id, card);
      return { status: "needs_approval", card };
    },

    /** Called by the person's button, outside the agent. */
    approve(cardId: string, approvedBy: string): Approval {
      const card = cards.get(cardId);
      if (!card) throw new Error("unknown card");
      const approval = { cardId, digest: card.digest, approvedBy };
      approvals.set(cardId, approval);
      return approval;
    },

    /** Runs an approved call. `grantNow` is the grant as it is at execution time. */
    async execute(approval: Approval, call: ToolCall, grantNow: Grant = options.grant): Promise<ExecuteOutcome> {
      const card = cards.get(approval.cardId);
      const issued = approvals.get(approval.cardId);
      if (!card || !issued || issued.digest !== approval.digest) return { status: "refused", reason: "no such approval" };
      if (used.has(card.id)) return { status: "refused", reason: "this approval was already used" };
      const workspace = workspaceOf(call, grantNow);
      if (digestOf(call, workspace) !== card.digest) {
        return { status: "refused", reason: "the call differs from the one on the card" };
      }
      const verdict = route(call, grantNow, registry());
      if (verdict.decision === "refuse") return { status: "refused", reason: `the policy refuses it now: ${verdict.reason}` };
      used.add(card.id);
      return { status: "done", result: await run(call, workspace) };
    },
  };
}
