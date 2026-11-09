/**
 * Two versions of the same reader: "members visible in the directory".
 * The data source resolves to { data, error }, like most database clients.
 */
export interface ProfileRow {
  id: string;
  name: string;
  visibility?: "members" | "hidden" | null;
}

export type ProfileSource = () => Promise<{ data: ProfileRow[] | null; error: unknown }>;

/**
 * Fails OPEN. On an error it serves the last good list, which still contains
 * people who hid their profile since. A row without a flag counts as visible.
 */
export async function listVisibleOpen(source: ProfileSource, lastGood: ProfileRow[]): Promise<ProfileRow[]> {
  try {
    const { data, error } = await source();
    if (error || !data) return lastGood;
    return data.filter((row) => row.visibility !== "hidden");
  } catch {
    return lastGood;
  }
}

/** Fails CLOSED. Any failure, or a row without an explicit "members", shows nobody. */
export async function listVisibleClosed(source: ProfileSource): Promise<ProfileRow[]> {
  try {
    const result = await source();
    if (!result || result.error || !Array.isArray(result.data)) return [];
    return result.data.filter((row) => row.visibility === "members");
  } catch {
    return [];
  }
}
