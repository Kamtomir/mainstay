/**
 * Migrations replay from scratch, and the ledger tells the truth.
 *
 * Runs after ci/migrations/apply-migrations.sh has applied every file to an
 * empty database. If a migration only worked on a database that already had
 * some hand-made object, the apply step failed before this file ran.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { databaseUrl, LEDGER_TABLE, MIGRATIONS_DIR, pool } from "./db";

const db = pool();
afterAll(() => db.end());

describe("migrations from scratch", () => {
  it("the ledger lists exactly the migration files: nothing missing, nothing extra", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const { rows } = await db.query<{ version: string }>(`select version from ${LEDGER_TABLE} order by version`);
    expect(rows.map((r) => r.version)).toEqual(files);
  });

  it("a second run applies nothing", () => {
    const res = spawnSync("bash", ["ci/migrations/apply-migrations.sh", databaseUrl()], {
      env: { ...process.env, MIGRATIONS_DIR, LEDGER_TABLE },
      encoding: "utf8",
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Nothing to apply/);
  });
});
