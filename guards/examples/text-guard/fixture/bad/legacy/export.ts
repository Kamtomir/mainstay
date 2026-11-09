import { db } from "../db";

// Kept as is on purpose: see the allowlist entry in the guard.
export function warmExportCache() {
  void db.rpc("refresh_export_cache");
}
