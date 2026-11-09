import { db } from "../db";

/** The one place that knows who may be listed. */
export function visibleProfiles(columns: string) {
  return db.from("profiles").select(columns).eq("visibility", "members");
}
