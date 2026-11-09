import { after } from "../runtime";
import { db } from "../db";

export async function recordLogin(userId: string) {
  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
  // Must not delay the response: the platform keeps the instance alive for it.
  after(() => db.from("audit_log").insert({ event: "login", user_id: userId }));
  return { ok: true };
}
