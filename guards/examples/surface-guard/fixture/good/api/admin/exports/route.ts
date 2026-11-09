import { rateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const limit = await rateLimit(request, "admin_export", {
    max: 2,
    window: "1m",
    store: "global",
  });
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });
  return Response.json({ queued: true });
}
