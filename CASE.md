# Reference deployment: Catch Club

Catch Club is a multi-tenant, white-label platform for paid Telegram
communities: a web cabinet for owners, Telegram bots, mini apps, public pages,
payments over several rails, an MCP server with OAuth 2.1 and AI agents. One
engineer, Kamil Dashdamirov, built it with Claude Code as the coding agent,
from 14 March to 7 November 2026. Most of the code was written by the agent,
under the rules this repository now holds.

The repository is private. mainstay is its quality system without the product:
no product code, migrations, prompts, community or member names, or secrets.

## The numbers

As of 6 and 7 November 2026: CI run `42307651951` on `main` (6 November, 22:50
UTC, the tip after the last merged PR) and the repository at that commit.

| Number | What | Source |
|---:|---|---|
| 15,826 | unit tests passing, in 1,407 files | Vitest in the CI run: 860.58 s, that is 14 min 21 s |
| 166 | integration tests on a real Postgres, in 19 files | the same run; every migration applied from scratch first |
| 26 min 12 s | the full CI run | should-run 15 s, then tests and build 25 min 46 s with integration 3 min 3 s in parallel |
| 23 | invariant guard suites (`*.guard.test.ts`) | the repository |
| 1,373 | pull requests merged into `main` | GitHub |
| 1,725 | commits in 238 days | the repository |
| 363 | SQL migrations, across three databases | the repository |
| 445k | lines of TypeScript in 2,483 source files, tests excluded | the repository |
| 143 | decision documents | the repository |

The last 30 days, to 9 November 2026, measured with
[metrics/baseline.mjs](metrics/baseline.mjs) (`WORKFLOW=ci.yml MIN_RUN_MINUTES=2`):

| Number | What |
|---:|---|
| 161 | merged PRs |
| 97.4% | of code PRs change at least one test file (150 of 154) |
| 5.7% | red share of CI runs that did the work (15 red, 247 green; 102 runs skipped by should-run, 55 cancelled) |
| 15 / 21 min | CI time, median and p90 |
| 0.5% | flaky signal: 2 of 419 commits both failed and passed with no code change |
| 0 | red runs on `main`: 147 green pushes and 14 cancelled, no failures |

## How to reproduce

The CI log and the repository are private: the commands run in a checkout with
read access. The author runs them live on request.

The test counts and durations come from the CI run log:

```bash
gh run view 42307651951 --log | grep -E "Test Files|Tests|Duration"
```

```
RPC integration (real Postgres)  Test Files  19 passed (19)
RPC integration (real Postgres)       Tests  166 passed (166)
RPC integration (real Postgres)    Duration  10.75s (transform 837ms, setup 0ms, import 2.31s, tests 6.29s, environment 2ms)
Test + Build (Next.js)           Test Files  1407 passed (1407)
Test + Build (Next.js)                Tests  15826 passed (15826)
Test + Build (Next.js)             Duration  860.58s (transform 30.06s, setup 0ms, import 233.97s, tests 408.72s, environment 159ms)
```

(Shown without the timestamps and colour codes the log carries. The integration
"Duration" is Vitest's own; the 3 min 3 s of the job include starting the
database and applying the migrations.)

The guard suites:

```bash
git ls-files | grep -c guard.test
```

```
23
```

The rest, in the same checkout:

```bash
# job durations
gh run view 42307651951 --json jobs --jq '.jobs[] | [.name, .startedAt, .completedAt] | @tsv'

# merged PRs, commits, migrations
gh pr list --state merged --base main --limit 5000 --json number --jq length
git rev-list --count HEAD
git ls-files 'supabase/*migrations/*.sql' | wc -l

# TypeScript source files and lines, tests excluded
git ls-files '*.ts' '*.tsx' | grep -v -E '\.test\.|\.spec\.|/tests/' | wc -l
git ls-files '*.ts' '*.tsx' | grep -v -E '\.test\.|\.spec\.|/tests/' | tr '\n' '\0' | xargs -0 cat | wc -l

# decision documents
git ls-files 'docs/*.md' | wc -l

# the 30-day baseline (from a clone of this repository)
OWNER=... REPO=... GITHUB_TOKEN=... DAYS=30 WORKFLOW=ci.yml MIN_RUN_MINUTES=2 node metrics/baseline.mjs
```

Rerun the same commands whenever this page is updated.

## The six layers there

| Layer | In the reference deployment | Here |
|---|---|---|
| Guards | 23 suites: a rate limit on every platform route, readers of private data fail closed, no regex lookbehind in client bundles, background jobs on the cheap model tier, a complete English fallback, no fire-and-forget lazy queries | the five helpers and five anonymised examples in [guards/](guards/) |
| Ratchet | a per-file budget of ad-hoc deployment checks, replaced step by step by a release registry the operator switches without a deploy | [guards/ratchet.ts](guards/ratchet.ts) and its example |
| CI gates | should-run, tests and build, integration on a real Postgres with every migration from scratch, a deploy watchdog every two hours | [ci/](ci/) |
| Agent evals | a 21-case refusal set for the owner's MCP agent, sanitizer tests in three modules, "money is dangerous" across 63 assistant tool modules | [evals/](evals/), with neutral cases |
| Agent contract | the repository's CLAUDE.md, security-scan and four-role audit skills, text guards before every push | [agent/](agent/), quality rules only |
| Incident → guard | browser errors land in a bug-report intake; a production incident becomes a guard the same day | [metrics/](metrics/) and the loop in the [README](README.md) |

## Limits

- No browser end-to-end tests: the Telegram surfaces are checked by hand,
  against checklists.
- Load tests ran once (August 2026) and are not part of CI.
- Escaped defects are not tracked by label yet; the first step of a rollout is
  to start (see [metrics/METRICS.md](metrics/METRICS.md)).
- It is a one-engineer case. A team of thirty needs the same system set up
  differently: owners for the guards and eval sets, a baseline first, targets
  after it.
