import { db } from "../db";

export async function moderationQueue() {
  const { data } = await db.from("profiles").select("id, name, visibility, reported_at").not("reported_at", "is", null);
  return data ?? [];
}
