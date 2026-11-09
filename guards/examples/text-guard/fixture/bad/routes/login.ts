import { db } from "../db";

export async function recordLogin(userId: string) {
  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", userId);
  void db
    .from("audit_log")
    .insert({ event: "login", user_id: userId });
  return { ok: true };
}
