import { listOrders } from "../../../../lib/orders";

/**
 * GET /api/orders/export?workspace=w1: a CSV for the finance team.
 * Added in a hurry; it never calls requireUser(), so anyone with the URL gets
 * every customer's email. This is the hole the guard is here to catch.
 */
export async function GET(request: Request): Promise<Response> {
  const workspace = new URL(request.url).searchParams.get("workspace") ?? "";
  const rows = listOrders(workspace).map((o) => [o.id, o.customerEmail, o.total].join(","));
  return new Response(["id,email,total", ...rows].join("\n"), { headers: { "content-type": "text/csv" } });
}
