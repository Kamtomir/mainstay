/**
 * Approval invariant: every writing tool goes through a card a person confirms
 * outside the agent, and money is always the dangerous kind.
 *
 * The card is the one checkpoint that does not depend on the model. So the
 * registry is checked as data (a tool added tomorrow with the wrong flags fails
 * here before it ships) and the executor is checked as behaviour (an approval
 * is bound to the exact call, works once, and loses to a policy that changed).
 *
 * In the reference deployment the class this closes was real: new money tools
 * were added to the registry without a consequence text, so the approver would
 * have seen a raw tool id instead of "this issues a real invoice".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutor, type Handler } from "./reference/executor";
import type { Grant, ToolCall } from "./reference/policy";
import { TOOLS, type ToolSpec } from "./reference/tools";

/** Words that mean money moves. A writing tool that uses them must say so in `money`. */
const LOOKS_LIKE_MONEY = /\b(?:pay|payment|payout|refund|invoice|charge|transfer|withdraw|billing|subscription|price|balance)s?\b/i;

const writes = TOOLS.filter((t) => t.effect === "write");
const ids = (tools: ToolSpec[]) => tools.map((t) => t.id);

describe("registry: every writing tool needs a card", () => {
  it("has reads and writes, so the checks below are not vacuous", () => {
    expect(TOOLS.some((t) => t.effect === "read")).toBe(true);
    expect(writes.length).toBeGreaterThanOrEqual(3);
  });

  it("no writing tool is marked safe (safe runs without a card)", () => {
    expect(ids(writes.filter((t) => t.risk === "safe"))).toEqual([]);
  });

  it("every money tool is dangerous", () => {
    expect(ids(TOOLS.filter((t) => t.money && t.risk !== "dangerous"))).toEqual([]);
  });

  it("a writing tool that sounds like money is flagged as money", () => {
    const unflagged = writes.filter((t) => !t.money && LOOKS_LIKE_MONEY.test(`${t.id.replace(/[._]/g, " ")} ${t.description}`));
    expect(ids(unflagged), "set `money` on these tools, or reword them if they really do not move money").toEqual([]);
  });

  it("money never leaves through an agent: no money-out tool is on the agent surface", () => {
    expect(ids(TOOLS.filter((t) => t.money === "out" && t.agentSurface))).toEqual([]);
  });

  it("personal data never leaves through an agent", () => {
    expect(ids(TOOLS.filter((t) => t.personalData && t.agentSurface))).toEqual([]);
  });

  it("every writing or dangerous tool tells the approver what will happen", () => {
    const silent = TOOLS.filter((t) => (t.effect === "write" || t.risk === "dangerous") && t.effect !== "read")
      .filter((t) => !t.consequence || t.consequence.trim().length < 20);
    expect(ids(silent), "add a consequence: the person approving reads it, not the tool id").toEqual([]);
  });

  it("money tools put the amount and the currency on the card", () => {
    const vague = TOOLS.filter((t) => t.money && !(t.consequence?.includes("{amount}") && t.consequence.includes("{currency}")));
    expect(ids(vague)).toEqual([]);
  });

  it("money coming in through an agent has a hard upper limit on the amount", () => {
    const unbounded = TOOLS.filter((t) => t.money === "in" && t.agentSurface && !t.limits?.some((l) => l.arg === "amount"));
    expect(ids(unbounded)).toEqual([]);
  });
});

describe("executor: the card is the checkpoint", () => {
  const grant: Grant = { scopes: ["workspace:read", "workspace:post", "billing:invoice"], workspaces: ["ws-own"] };
  const invoice: ToolCall = { tool: "invoices.create", args: { amount: 1200, currency: "USD", customer: "cus_1", memo: "Spring event" } };
  let registry: ToolSpec[];
  let handlers: Record<string, ReturnType<typeof vi.fn<Handler>>>;

  beforeEach(() => {
    registry = TOOLS;
    handlers = {
      "invoices.create": vi.fn<Handler>(async (args) => ({ invoice: "inv_1", amount: args.amount })),
      "messages.post": vi.fn<Handler>(async () => ({ posted: true })),
      "stats.summary": vi.fn<Handler>(async () => ({ signups: 12 })),
    };
  });
  const executor = () => createExecutor({ grant, handlers, tools: () => registry });

  it("a read runs at once", async () => {
    const out = await executor().request({ tool: "stats.summary", args: {} });
    expect(out).toEqual({ status: "done", result: { signups: 12 } });
  });

  it("a write never runs on request: it comes back as a card and the handler is not called", async () => {
    const out = await executor().request(invoice);
    expect(out.status).toBe("needs_approval");
    expect(handlers["invoices.create"]).not.toHaveBeenCalled();
  });

  it("the card is built from the real arguments, and free text is shown as quoted data", async () => {
    const out = await executor().request(invoice);
    if (out.status !== "needs_approval") throw new Error("expected a card");
    expect(out.card.consequence).toBe("Issues a real invoice for 1200 USD to customer cus_1. The customer is asked to pay it.");
    expect(out.card.untrusted).toEqual({ memo: "Spring event" });
  });

  it("after approval the exact call runs once; a replay is refused", async () => {
    const ex = executor();
    const out = await ex.request(invoice);
    if (out.status !== "needs_approval") throw new Error("expected a card");
    const approval = ex.approve(out.card.id, "owner");
    expect(await ex.execute(approval, invoice)).toMatchObject({ status: "done" });
    expect(await ex.execute(approval, invoice)).toEqual({ status: "refused", reason: "this approval was already used" });
    expect(handlers["invoices.create"]).toHaveBeenCalledTimes(1);
  });

  it("an approval is bound to the call it was shown for: a changed amount is refused", async () => {
    const ex = executor();
    const out = await ex.request(invoice);
    if (out.status !== "needs_approval") throw new Error("expected a card");
    const approval = ex.approve(out.card.id, "owner");
    const swapped = { ...invoice, args: { ...invoice.args, amount: 4999 } };
    expect(await ex.execute(approval, swapped)).toEqual({ status: "refused", reason: "the call differs from the one on the card" });
    expect(handlers["invoices.create"]).not.toHaveBeenCalled();
  });

  it("the policy is checked again at execution: a limit lowered after the card was shown wins", async () => {
    const ex = executor();
    const out = await ex.request(invoice);
    if (out.status !== "needs_approval") throw new Error("expected a card");
    const approval = ex.approve(out.card.id, "owner");
    registry = TOOLS.map((t) => (t.id === "invoices.create" ? { ...t, limits: [{ arg: "amount", min: 0.01, max: 1000 }] } : t));
    const res = await ex.execute(approval, invoice);
    expect(res.status).toBe("refused");
    expect(handlers["invoices.create"]).not.toHaveBeenCalled();
  });

  it("a grant revoked before the click wins too", async () => {
    const ex = executor();
    const out = await ex.request(invoice);
    if (out.status !== "needs_approval") throw new Error("expected a card");
    const approval = ex.approve(out.card.id, "owner");
    const res = await ex.execute(approval, invoice, { scopes: ["workspace:read"], workspaces: ["ws-own"] });
    expect(res.status).toBe("refused");
    expect(handlers["invoices.create"]).not.toHaveBeenCalled();
  });

  it("a refused call produces no card and runs nothing", async () => {
    const out = await executor().request({ tool: "payouts.create", args: { amount: 10, currency: "USD", recipient: "x" } });
    expect(out.status).toBe("refused");
    expect(Object.values(handlers).every((h) => h.mock.calls.length === 0)).toBe(true);
  });
});
