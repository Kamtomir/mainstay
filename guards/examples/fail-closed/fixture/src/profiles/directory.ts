import { db } from "../db";

export async function directoryPage(offset: number) {
  const { data } = await db
    .from("profiles")
    .select("id, name, headline")
    .eq("visibility", "members")
    .range(offset, offset + 49);
  return data ?? [];
}
