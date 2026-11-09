import { rateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const limit = await rateLimit(request, "admin_invite", { max: 5, window: "1m" });
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });
  return Response.json({ invited: true });
}
