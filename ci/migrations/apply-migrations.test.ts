/**
 * Tests for apply-migrations.sh with a stub `psql` on PATH: no database needed.
 *
 * The stub answers the script's few questions from scenario variables and logs
 * everything the script tries to EXECUTE, so "refused" and "quietly applied"
 * cannot be confused. The integration job runs the same script against a real
 * Postgres (ci/integration).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./apply-migrations.sh", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "mainstay-migrate-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const STUB = `#!/usr/bin/env bash
prev=""; query=""; file=""; tx="notx"
for a in "$@"; do
  [[ "$prev" == "-c" ]] && query="$a"
  [[ "$prev" == "-f" ]] && file="$a"
  [[ "$a" == "--single-transaction" ]] && tx="tx"
  prev="$a"
done
if [[ -n "$file" ]]; then
  name="$(basename "$file")"
  echo "FILE:$name:$tx" >> "$PSQL_LOG"
  [[ "$name" == "\${S_FAIL:-}" ]] && { echo "ERROR: boom" >&2; exit 3; }
  exit 0
fi
case "$query" in
  *current_database*) echo "\${S_DB-app_test}" ;;
  *to_regclass*) echo "\${S_HAD_LEDGER:-f}" ;;
  "select version from"*) printf '%s' "\${S_APPLIED:-}" | tr '|' '\\n' ;;
  *information_schema.tables*) echo "\${S_TABLES:-0}" ;;
  *"insert into"*) v="\${query#*values (\\'}"; echo "RECORD:\${v%%\\'*}" >> "$PSQL_LOG" ;;
  *"create schema"*) echo "DDL" >> "$PSQL_LOG" ;;
esac
exit 0
`;

const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "psql"), STUB);
chmodSync(join(bin, "psql"), 0o755);

const migrations = join(work, "migrations");
mkdirSync(migrations);
writeFileSync(join(migrations, "0001_init.sql"), "create table accounts (id int);\n");
writeFileSync(join(migrations, "0002_orders.sql"), "create table orders (id int);\n");
writeFileSync(join(migrations, "0002_orders_index.sql"), "create index concurrently orders_id on orders (id);\n");
writeFileSync(join(migrations, "0003_status.sql"), "alter type order_status add value 'refunded';\n");
writeFileSync(join(migrations, "README.md"), "not a migration\n");

let n = 0;
function migrate(args: string[], scenario: Record<string, string> = {}) {
  const log = join(work, `log-${++n}`);
  writeFileSync(log, "");
  const res = spawnSync("bash", [SCRIPT, ...args, "postgresql://localhost/app_test"], {
    env: { PATH: `${bin}:${process.env.PATH}`, MIGRATIONS_DIR: migrations, PSQL_LOG: log, ...scenario },
    encoding: "utf8",
  });
  const executed = readFileSync(log, "utf8").split("\n").filter((l) => l && l !== "DDL");
  return { code: res.status, out: res.stdout + res.stderr, executed };
}

describe.skipIf(process.platform === "win32")("apply-migrations.sh", () => {
  it("an empty database: applies every file in order and records each after it ran", () => {
    const r = migrate([]);
    expect(r.code, r.out).toBe(0);
    expect(r.executed).toEqual([
      "FILE:0001_init.sql:tx",
      "RECORD:0001_init.sql",
      "FILE:0002_orders.sql:tx",
      "RECORD:0002_orders.sql",
      "FILE:0002_orders_index.sql:notx",
      "RECORD:0002_orders_index.sql",
      "FILE:0003_status.sql:notx",
      "RECORD:0003_status.sql",
    ]);
  });

  it("keys by full filename: two files with the same number are both applied", () => {
    const r = migrate([], { S_HAD_LEDGER: "t", S_APPLIED: "0001_init.sql|0002_orders.sql" });
    expect(r.executed.filter((l) => l.startsWith("FILE:"))).toEqual(["FILE:0002_orders_index.sql:notx", "FILE:0003_status.sql:notx"]);
  });

  it("refuses a live database without a ledger and executes nothing", () => {
    const r = migrate([], { S_TABLES: "153" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/REFUSED: found 153 table/);
    expect(r.out).toMatch(/no ledger table at all/);
    expect(r.executed).toEqual([]);
  });

  it("refuses a ledger keyed some other way (e.g. by number) just the same", () => {
    const r = migrate([], { S_TABLES: "153", S_HAD_LEDGER: "t", S_APPLIED: "0001|0002" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/another format, e.g. '0001'/);
    expect(r.executed).toEqual([]);
  });

  it("stops at the first failure: earlier files stay recorded, the failed one is not", () => {
    const r = migrate([], { S_FAIL: "0002_orders.sql" });
    expect(r.code).not.toBe(0);
    expect(r.executed).toEqual(["FILE:0001_init.sql:tx", "RECORD:0001_init.sql", "FILE:0002_orders.sql:tx"]);
  });

  it("dry run lists the pending files and executes nothing", () => {
    const r = migrate(["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Pending: 4/);
    expect(r.executed).toEqual([]);
  });

  it("baseline records files up to a number and runs none of them", () => {
    const r = migrate(["--baseline", "2"], { S_TABLES: "153" });
    expect(r.code, r.out).toBe(0);
    expect(r.executed).toEqual(["RECORD:0001_init.sql", "RECORD:0002_orders.sql", "RECORD:0002_orders_index.sql"]);
  });

  it("nothing pending: says so and executes nothing", () => {
    const all = "0001_init.sql|0002_orders.sql|0002_orders_index.sql|0003_status.sql";
    const r = migrate([], { S_HAD_LEDGER: "t", S_APPLIED: all, S_TABLES: "4" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Nothing to apply/);
    expect(r.executed).toEqual([]);
  });

  it("a database it cannot reach is an error, not an empty database", () => {
    const r = migrate([], { S_DB: "" });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/cannot connect/);
    expect(r.executed).toEqual([]);
  });
});
