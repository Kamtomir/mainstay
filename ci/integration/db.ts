import pg from "pg";

/** The integration database. Fails loudly: a silently skipped integration suite looks green. */
export function databaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start Postgres, apply the migrations with ci/migrations/apply-migrations.sh, then run npm run test:integration.",
    );
  }
  return url;
}

export function pool(): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl(), max: 2 });
}

/** The role the application connects as; the grants test checks it. */
export const APP_ROLE = process.env.APP_ROLE ?? "app_rw";

/** Schemas the application owns. */
export const APP_SCHEMAS = (process.env.APP_SCHEMAS ?? "public").split(",").map((s) => s.trim());

/** Where the migration files live; the drift test compares them with the ledger. */
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? "ci/integration/migrations";
export const LEDGER_TABLE = process.env.LEDGER_TABLE ?? "public.schema_migrations";
