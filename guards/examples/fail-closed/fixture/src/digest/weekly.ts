import { db } from "../db";

/** "New this week" block of the weekly email. */
export async function newMembers(since: string) {
  const { data } = await db.from("profiles").select("id, name, joined_at").gte("joined_at", since);
  return data ?? [];
}
