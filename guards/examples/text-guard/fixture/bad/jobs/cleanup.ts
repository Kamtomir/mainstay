import { db } from "../db";

export async function cleanupSessions(now: string) {
  // We do not want to wait for the delete, so we fire and forget it:
  // `void db.from("sessions").delete()` — the comment is allowed, the code below is not.
  void db.from("sessions").delete().lt("expires_at", now);
}
