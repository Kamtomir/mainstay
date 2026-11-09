#!/usr/bin/env bash
#
# apply-migrations.sh: apply pending SQL migrations to a Postgres database.
#
# Reads $MIGRATIONS_DIR/*.sql, applies the files the ledger does not list yet,
# in filename order, and records each file only after it commits. In CI it runs
# against an empty database on every PR: the whole history must replay.
#
# SAFETY
#   * One transaction per file. A failure rolls that file back and stops the
#     run; earlier files stay applied and recorded, so a re-run resumes there.
#   * A file is recorded only after it commits.
#   * Files that cannot run inside a transaction (ALTER TYPE ... ADD VALUE,
#     CREATE INDEX CONCURRENTLY, or a line "-- migrate: no-transaction") run
#     without one; psql still stops at the first error.
#   * The ledger key is the FULL filename, not the numeric prefix: two branches
#     that both added 0042_*.sql stay two different migrations.
#   * It refuses to blind-apply. When the application schemas already have
#     tables but the ledger recognises none of the files, "apply everything"
#     would replay the whole history over a live schema. Adopt the current
#     state once with --baseline, then every later run is incremental.
#
# USAGE
#   apply-migrations.sh "$DATABASE_URL"                  apply what is pending
#   apply-migrations.sh --dry-run "$DATABASE_URL"        list it, change nothing
#   apply-migrations.sh --baseline 0042 "$DATABASE_URL"  record files up to 0042
#                                                        as applied, run nothing
#
# ENVIRONMENT
#   MIGRATIONS_DIR  directory of NNNN_name.sql files      (default: db/migrations)
#   LEDGER_TABLE    schema.table that records applied ones (default: public.schema_migrations)
#   APP_SCHEMAS     schemas that count as "live"           (default: public)
#   DATABASE_URL    used when no URL argument is given
#
# The URL holds a password: pass it in an environment variable, never in a
# committed file or on a shared screen.
#
# Works with bash 3.2 (macOS). Needs psql.
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-db/migrations}"
LEDGER_TABLE="${LEDGER_TABLE:-public.schema_migrations}"
APP_SCHEMAS="${APP_SCHEMAS:-public}"
DRY_RUN=0
BASELINE=""
DB_URL=""

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --baseline) BASELINE="${2:-}"; [[ -n "$BASELINE" ]] || { echo "--baseline needs a file name or a number" >&2; exit 2; }; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) DB_URL="$1"; shift ;;
  esac
done
DB_URL="${DB_URL:-${DATABASE_URL:-}}"
[[ -n "$DB_URL" ]] || { echo "no database URL: pass it as an argument or set DATABASE_URL" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }
[[ -d "$MIGRATIONS_DIR" ]] || { echo "no migrations directory: $MIGRATIONS_DIR" >&2; exit 2; }
[[ "$LEDGER_TABLE" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]] || { echo "LEDGER_TABLE must look like schema.table" >&2; exit 2; }
LEDGER_SCHEMA="${LEDGER_TABLE%%.*}"
LEDGER_NAME="${LEDGER_TABLE#*.}"

# Sorted by full filename, which is also the ledger key. `while read` instead
# of mapfile: bash 3.2 has no mapfile and would leave the array empty.
FILES=()
while IFS= read -r name || [[ -n "$name" ]]; do
  FILES+=("$name")
done < <(cd "$MIGRATIONS_DIR" && ls -1 2>/dev/null | grep -E '^[0-9]+_.*\.sql$' | sort)
[[ ${#FILES[@]} -gt 0 ]] || { echo "no NNNN_name.sql files in $MIGRATIONS_DIR" >&2; exit 2; }

# Only warnings and errors from the server: "already exists, skipping" notices are noise.
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
psql_do()  { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_val() { psql "$DB_URL" -X -q -t -A -c "$1" 2>/dev/null || true; }

DB_NAME="$(psql_val "select current_database()")"
[[ -n "$DB_NAME" ]] || { echo "cannot connect to the database" >&2; exit 1; }
echo "Database: $DB_NAME, ledger $LEDGER_TABLE, ${#FILES[@]} migration files in $MIGRATIONS_DIR"

HAD_LEDGER="$(psql_val "select to_regclass('$LEDGER_TABLE') is not null")"
if [[ $DRY_RUN -eq 0 ]]; then
  psql_do -c "create schema if not exists $LEDGER_SCHEMA;
              create table if not exists $LEDGER_TABLE (
                version    text primary key,
                applied_at timestamptz not null default now()
              );"
fi

# The leading number of a file name, without leading zeros (bash 3.2 arithmetic).
number_of() { local n="${1%%_*}"; echo $((10#$n)); }

if [[ -n "$BASELINE" ]]; then
  marked=0
  for f in "${FILES[@]}"; do
    if [[ "$BASELINE" =~ ^[0-9]+$ ]]; then
      [[ $(number_of "$f") -le $((10#$BASELINE)) ]] || continue
    else
      [[ ! "$f" > "$BASELINE" ]] || continue
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  [dry-run] would record $f"
    else
      psql_do -c "insert into $LEDGER_TABLE (version) values ('$f') on conflict (version) do nothing;"
    fi
    marked=$((marked + 1))
  done
  echo "Baseline up to $BASELINE: $marked files recorded as applied. Nothing was executed."
  exit 0
fi

APPLIED=()
if [[ "$HAD_LEDGER" == "t" ]]; then
  # `|| [[ -n "$v" ]]` keeps a last line that has no trailing newline.
  while IFS= read -r v || [[ -n "$v" ]]; do
    [[ -n "$v" ]] && APPLIED+=("$v")
  done < <(psql_val "select version from $LEDGER_TABLE")
fi
is_applied() { local a; for a in "${APPLIED[@]:-}"; do [[ "$a" == "$1" ]] && return 0; done; return 1; }

RECOGNISED=0
for f in "${FILES[@]}"; do is_applied "$f" && RECOGNISED=$((RECOGNISED + 1)); done

# A missing ledger, an empty one, and one keyed some other way ("0042" instead
# of "0042_add_orders.sql") look the same from here: nothing in it matches a
# file. On a database with live tables that means "replay everything over
# production", so stop.
if [[ $RECOGNISED -eq 0 ]]; then
  schemas_sql="'$(printf '%s' "$APP_SCHEMAS" | sed "s/[[:space:]]*,[[:space:]]*/','/g")'"
  tables="$(psql_val "select count(*) from information_schema.tables
                      where table_schema in ($schemas_sql)
                        and not (table_schema = '$LEDGER_SCHEMA' and table_name = '$LEDGER_NAME')")"
  if [[ "${tables:-0}" -gt 0 ]]; then
    echo "REFUSED: found $tables table(s) in $APP_SCHEMAS, but the ledger recognises none of the ${#FILES[@]} files." >&2
    if [[ "$HAD_LEDGER" != "t" ]]; then
      echo "  There was no ledger table at all." >&2
    elif [[ ${#APPLIED[@]} -eq 0 ]]; then
      echo "  The ledger table is empty." >&2
    else
      echo "  The ledger has ${#APPLIED[@]} rows in another format, e.g. '${APPLIED[0]}'; this script keys by full file name." >&2
    fi
    echo "  Applying every file over a live schema is dangerous. Record the current state first:" >&2
    echo "    $0 --baseline <last applied number or file> \"\$DATABASE_URL\"" >&2
    exit 1
  fi
fi

PENDING=()
for f in "${FILES[@]}"; do is_applied "$f" || PENDING+=("$f"); done
if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "Nothing to apply: all ${#FILES[@]} migrations are recorded."
  exit 0
fi

echo "Pending: ${#PENDING[@]}"
for f in "${PENDING[@]}"; do echo "  - $f"; done
if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] nothing was executed."
  exit 0
fi

for f in "${PENDING[@]}"; do
  printf '  applying %s ... ' "$f"
  if grep -qiE 'alter[[:space:]]+type.*add[[:space:]]+value|concurrently|^--[[:space:]]*migrate:[[:space:]]*no-transaction' "$MIGRATIONS_DIR/$f"; then
    psql_do -f "$MIGRATIONS_DIR/$f"
  else
    psql_do --single-transaction -f "$MIGRATIONS_DIR/$f"
  fi
  psql_do -c "insert into $LEDGER_TABLE (version) values ('$f') on conflict (version) do nothing;"
  echo "done"
done
echo "Applied ${#PENDING[@]} migrations."
