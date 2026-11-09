# ci

GitHub Actions templates for a guard-first pipeline, and the scripts they call.
Every script has tests here; the templates themselves are checked by
[templates.test.ts](templates.test.ts): no secrets, explicit permissions, a
timeout on every job, actions pinned to a version, and expressions that use only
the contexts GitHub allows where they stand (a `job.` expression in a job's own
`env` makes the whole file invalid).

## The pipeline

```
should-run (~15 s) ──► guards (< 2 min) ──► tests + build
                                        └─► integration (real Postgres)     in parallel

deploy watchdog: every 2 hours, independent of pushes
```

| Template | What it does |
|---|---|
| [guard-first.yml](guard-first.yml) | `should-run` decides whether the heavy jobs are needed; `guards` runs every `*.guard.test.ts`; `test-build` runs typecheck, unit tests and the build; `integration` calls the Postgres workflow. A red guard stops the run before the long jobs start. |
| [integration-postgres.yml](integration-postgres.yml) | A reusable workflow. Variant `service`: a `postgres:17` container on a port the runner picks. Variant `supabase`: the Supabase CLI stack, with the CLI pinned, its port block reserved and auto-apply bypassed. Both apply every migration to an empty database, then run `npm run test:integration`. |
| [deploy-watchdog.yml](deploy-watchdog.yml) | On a schedule: is the newest deployable commit on main in production in every listed environment? Opens one issue per missing commit, closes it when production catches up. |

## Installing

| From | To |
|---|---|
| `ci/guard-first.yml` | `.github/workflows/ci.yml` |
| `ci/integration-postgres.yml` | `.github/workflows/integration-postgres.yml` |
| `ci/deploy-watchdog.yml` | `.github/workflows/deploy-watchdog.yml` |
| `ci/should-run.sh` | `.github/scripts/should-run.sh` |
| `ci/migrations/apply-migrations.sh` | `.github/scripts/apply-migrations.sh` |
| `ci/deploy-watchdog.mjs` | `.github/scripts/deploy-watchdog.mjs` |

No secrets are needed anywhere: the workflows use their own `GITHUB_TOKEN` with
read permissions (and `issues: write` for the watchdog).

## should-run.sh

On a push to main after a squash merge, the code is what CI just checked on the
PR branch. The script compares file *trees*: if the squash commit's tree equals
the PR head's tree and that head has a green run, the heavy jobs are skipped.
Every uncertainty means run: no PR, no green run, an API error. In the reference
deployment the skipped runs were 44% of all CI minutes.

[should-run.test.ts](should-run.test.ts) puts a stub `gh` on `PATH` and proves
there is exactly one way to skip.

## apply-migrations.sh

Plain SQL files `NNNN_name.sql`, applied in filename order, one transaction per
file, each recorded in a ledger table only after it commits. The ledger key is
the full filename, so two branches that both added `0042_*.sql` stay two
migrations. It refuses to replay history over a live schema the ledger does not
explain (a database migrated by hand, or a ledger keyed by number) and offers
`--baseline` to adopt the current state once. `--dry-run` lists what would run.

[migrations/apply-migrations.test.ts](migrations/apply-migrations.test.ts) uses a
stub `psql` that records what would be executed. The integration job runs the
real thing.

## integration/

Templates for the integration suite, run by `npm run test:integration` against a
database the script has just migrated:

- [migrations.int.test.ts](integration/migrations.int.test.ts): the ledger lists
  exactly the migration files, and a second run applies nothing;
- [rpc-smoke.int.test.ts](integration/rpc-smoke.int.test.ts): call every RPC once
  for real. A plpgsql body is checked on its first call, which mocks never make;
- [grants.int.test.ts](integration/grants.int.test.ts): the app role can use
  every table and function, PUBLIC can use none. A table added without a grant
  answers "permission denied" to the app and nothing else notices.

[integration/migrations](integration/migrations) holds a three-file example
schema; replace it with yours (`MIGRATIONS_DIR`).

## deploy-watchdog.mjs

Walks back from the tip of main to the newest commit that changes something
outside `IGNORE_PATHS`, waits `THRESHOLD_MIN` minutes, then wants a successful
GitHub Deployment in every environment of `ENVIRONMENTS`, matched exactly: a
preview whose name ends like the production one never counts. Keep
`IGNORE_PATHS` identical to your host's own ignore rule; two copies of one rule
drift apart, and then the watchdog cries wolf every run.

[deploy-watchdog.test.ts](deploy-watchdog.test.ts) runs it against a fake commit
graph and an in-memory GitHub API.
