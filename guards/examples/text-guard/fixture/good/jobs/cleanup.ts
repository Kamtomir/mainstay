import { db } from "../db";

export async function cleanupSessions(now: string) {
  // Awaited: the job is the request, there is no response to delay.
  await db.from("sessions").delete().lt("expires_at", now);
}
