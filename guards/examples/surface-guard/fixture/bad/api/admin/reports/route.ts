import { rateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const body = await request.json();
  const limit = await rateLimit(request, "admin_report", {
    max: 1,
    window: "10m",
  });
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });
  return Response.json({ report: body.kind });
}
