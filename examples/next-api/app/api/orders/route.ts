import { requireUser } from "../../../lib/auth";
import { listOrders } from "../../../lib/orders";

/** GET /api/orders: the signed-in user's workspace orders. */
export async function GET(request: Request): Promise<Response> {
  const auth = requireUser(request);
  if (!auth.ok) return auth.response;
  return Response.json({ orders: listOrders(auth.user.workspaceId) });
}
