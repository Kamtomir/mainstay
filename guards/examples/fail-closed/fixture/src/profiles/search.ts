import { visibleProfiles } from "./visibility";

export async function searchProfiles(term: string) {
  const { data } = await visibleProfiles("id, name").ilike("name", `%${term}%`);
  return data ?? [];
}
