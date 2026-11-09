/**
 * A reference tool registry for an agent that works inside a workspace app.
 *
 * Replace it with your own registry, keep the fields. The approval invariant
 * test reads these fields; the policy router decides with them.
 */

export type Effect = "read" | "write";
export type Risk = "safe" | "moderate" | "dangerous";

export interface ToolLimit {
  /** Argument name, e.g. "amount". */
  arg: string;
  min?: number;
  max: number;
}

export interface ToolSpec {
  id: string;
  /** What the tool does, in one sentence. */
  description: string;
  effect: Effect;
  /** safe: runs without a card. moderate and dangerous: a person confirms every call. */
  risk: Risk;
  /** Scopes the caller's grant must hold. */
  scopes: string[];
  /** Offered to external agents (MCP clients, API keys). Everything else is done by a person in the app. */
  agentSurface: boolean;
  /** Moves money: "in" through the platform (invoices, charges) or "out" (refunds, payouts, transfers). */
  money?: "in" | "out";
  /** Returns personal data of people other than the caller. */
  personalData?: boolean;
  /** Numeric bounds the server enforces, whatever the agent asks. */
  limits?: ToolLimit[];
  /** A destructive list argument: at most `max` explicit items, never a wildcard. */
  bulk?: { arg: string; max: number };
  /** Free-text arguments: shown on the card as quoted data, never interpreted. */
  untrustedArgs?: string[];
  /** What the person approving reads. {arg} placeholders are filled from the real arguments. */
  consequence?: string;
}

export const TOOLS: ToolSpec[] = [
  {
    id: "stats.summary",
    description: "Aggregated counts for the workspace: sign-ups, orders, revenue.",
    effect: "read",
    risk: "safe",
    scopes: ["workspace:read"],
    agentSurface: true,
  },
  {
    id: "orders.list",
    description: "Orders of one workspace, without customer contacts.",
    effect: "read",
    risk: "safe",
    scopes: ["workspace:read"],
    agentSurface: true,
  },
  {
    id: "payments.list",
    description: "Incoming payments of the workspace.",
    effect: "read",
    risk: "safe",
    scopes: ["billing:read"],
    agentSurface: true,
  },
  {
    id: "members.export",
    description: "Member list with emails and phone numbers.",
    effect: "read",
    risk: "dangerous",
    scopes: ["members:export"],
    agentSurface: false,
    personalData: true,
  },
  {
    id: "messages.post",
    description: "Posts a message to the community chat as the workspace.",
    effect: "write",
    risk: "moderate",
    scopes: ["workspace:post"],
    agentSurface: true,
    untrustedArgs: ["text"],
    consequence: "Posts the text below to the community chat as the workspace. Every member of the chat sees it.",
  },
  {
    id: "invoices.create",
    description: "Issues an invoice to a customer, paid through the platform.",
    effect: "write",
    risk: "dangerous",
    scopes: ["billing:invoice"],
    agentSurface: true,
    money: "in",
    limits: [{ arg: "amount", min: 0.01, max: 5000 }],
    untrustedArgs: ["memo"],
    consequence: "Issues a real invoice for {amount} {currency} to customer {customer}. The customer is asked to pay it.",
  },
  {
    id: "members.remove",
    description: "Removes members from the workspace.",
    effect: "write",
    risk: "dangerous",
    scopes: ["members:manage"],
    agentSurface: true,
    bulk: { arg: "member_ids", max: 1 },
    consequence: "Removes member {member_ids} from the workspace. They lose access at once.",
  },
  {
    id: "payments.refund",
    description: "Refunds a payment to the customer's card.",
    effect: "write",
    risk: "dangerous",
    scopes: ["billing:refund"],
    agentSurface: false,
    money: "out",
    consequence: "Refunds {amount} {currency} to the customer. The money leaves the workspace balance.",
  },
  {
    id: "payouts.create",
    description: "Sends money from the workspace balance to a recipient.",
    effect: "write",
    risk: "dangerous",
    scopes: ["billing:payout"],
    agentSurface: false,
    money: "out",
    consequence: "Sends {amount} {currency} from the workspace balance to {recipient}.",
  },
];
