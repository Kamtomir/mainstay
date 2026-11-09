import { rateLimit } from "../../../lib/rate-limit";
import { withTenant } from "../../../lib/tenant";

export async function GET(request: Request) {
  const tenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  return withTenant(tenantId, async () => {
    // Inside the tenant: counting in the tenant's store is the point here.
    const limit = await rateLimit(request, "member_search", { max: 30, window: "1m" });
    if (!limit.allowed) return new Response("Too many requests", { status: 429 });
    return Response.json({ members: [] });
  });
}
