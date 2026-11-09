/**
 * Grants: the application role can use every table and function it needs, and
 * PUBLIC can use none of them.
 *
 * A table added without a grant answers "permission denied" (42501) to the app
 * and nothing else notices: the migration passed, the tests with a superuser
 * passed. A function created without REVOKE ... FROM PUBLIC is callable by
 * every role, and a SECURITY DEFINER one runs with its owner's rights.
 */
import { afterAll, describe, expect, it } from "vitest";
import { APP_ROLE, APP_SCHEMAS, LEDGER_TABLE, pool } from "./db";

const db = pool();
afterAll(() => db.end());

const [ledgerSchema, ledgerName] = LEDGER_TABLE.split(".");

async function tables(): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select table_schema || '.' || table_name as name from information_schema.tables
      where table_schema = any($1) and table_type = 'BASE TABLE'
        and not (table_schema = $2 and table_name = $3)
      order by 1`,
    [APP_SCHEMAS, ledgerSchema, ledgerName],
  );
  return rows.map((r) => r.name);
}

describe("grants", () => {
  it("finds the tables (an empty list would make the checks below pass for nothing)", async () => {
    expect((await tables()).length).toBeGreaterThan(0);
  });

  it(`${APP_ROLE} can select from every application table`, async () => {
    const missing: string[] = [];
    for (const t of await tables()) {
      const { rows } = await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, 'select') as ok", [APP_ROLE, t]);
      if (!rows[0].ok) missing.push(t);
    }
    expect(missing, `grant select (and what else the app needs) on these to ${APP_ROLE}`).toEqual([]);
  });

  it("PUBLIC has no privilege on any application table", async () => {
    const { rows } = await db.query<{ grant: string }>(
      `select table_schema || '.' || table_name || ': ' || privilege_type as grant
         from information_schema.role_table_grants
        where grantee = 'PUBLIC' and table_schema = any($1)
        order by 1`,
      [APP_SCHEMAS],
    );
    expect(rows.map((r) => r.grant)).toEqual([]);
  });

  it("functions: PUBLIC cannot execute them, the app role can", async () => {
    const { rows } = await db.query<{ fn: string; public_can: boolean; app_can: boolean }>(
      `select p.oid::regprocedure::text as fn,
              coalesce(p.proacl is null or exists (
                select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ), true) as public_can,
              has_function_privilege($2, p.oid, 'execute') as app_can
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and p.prokind = 'f'
        order by 1`,
      [APP_SCHEMAS, APP_ROLE],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.public_can).map((r) => r.fn), "revoke execute ... from public").toEqual([]);
    expect(rows.filter((r) => !r.app_can).map((r) => r.fn), `grant execute ... to ${APP_ROLE}`).toEqual([]);
  });
});
