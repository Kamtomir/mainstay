export interface User {
  id: string;
  workspaceId: string;
}

export type AuthResult = { ok: true; user: User } | { ok: false; response: Response };

/**
 * The session check every route must call first.
 *
 * Demo only: it accepts a bearer token "demo-<user>-<workspace>". A real app
 * verifies a signed session cookie or token here.
 */
export function requireUser(request: Request): AuthResult {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer demo-(\w+)-(\w+)$/.exec(header);
  if (!match) return { ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true, user: { id: match[1], workspaceId: match[2] } };
}
