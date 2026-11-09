# mainstay

**A quality system for AI-assisted development. Main stays green.**

When an agent writes the code, a team ships five or six pull requests a day and
the usual quality control stops scaling: manual regression cannot keep up, tests
"written afterwards" never get written, and no reviewer reads the whole stream.
The question changes from "how do we test this feature" to "how do we make sure
no PR breaks the product's invariants": private data, money, access rights.

mainstay answers with checks that run on every PR and do not care who wrote the
code. It is the open, product-free core of a system that kept one engineer and
Claude Code at 15,826 green unit tests, 166 integration tests on a real Postgres
and 1,373 merged PRs in eight months ([CASE.md](CASE.md)).

## The six layers

| | Layer | The rule it enforces | Here |
|---|---|---|---|
| 1 | **Invariant guards** | Tests that read the source and fail when a rule is broken: every route checks the session, client bundles have no regex lookbehind, readers of private data fail closed. | [guards/](guards/) |
| 2 | **Ratchet budgets** | Known debt is counted per file and can only go down. New debt is a decision visible in the diff. | [guards/ratchet.ts](guards/ratchet.ts) |
| 3 | **CI gates** | The cheapest signal first: should-run, guards, tests and build, integration on a real database with every migration from scratch, a watchdog that checks main is really deployed. | [ci/](ci/) |
| 4 | **Agent evals** | A deterministic refusal set: what the server must do with each tool call an agent makes (refuse, card, allow). Sanitizer tests for model input and output. An approval invariant: every write goes through a card a person confirms outside the agent. | [evals/](evals/) |
| 5 | **A contract for the coding agent** | Quality rules the agent reads on every task: inspect first, never commit to main, every PR updates the backlog, security constraints as conditions. A pre-push hook and a PR checklist. | [agent/](agent/) |
| 6 | **Incident → guard** | A production incident ends with a guard in the same PR, so its class of failure cannot come back. Measured by six metrics with a day-zero baseline. | [metrics/](metrics/) |

## 15-minute setup for a TypeScript repository

Clone this repository next to yours (`git clone <this repo's URL> ../mainstay`),
then, from your repository:

**1. Copy the guards and add Vitest** (2 minutes). The helpers depend on Vitest
and Node built-ins only.

```bash
mkdir -p test/guards && rsync -a --exclude examples --exclude '*.test.ts' ../mainstay/guards/ test/guards/ && npm i -D vitest
```

**2. Write the first guard** (5 minutes). One call is a whole guard: it checks
that it sees the files, that the rule holds, and that the allowlist has no dead
entries. Save it as `test/guards/routes.guard.test.ts`:

```ts
import { surfaceGuard } from "./surface-guard";

surfaceGuard({
  name: "every API route checks the session",
  root: "src/app/api",
  files: /(^|\/)route\.ts$/,
  require: /\brequireUser\(/,
  requirement: "call requireUser(request)",
  allow: { "health/route.ts": "liveness probe: answers 200 and returns no data" },
});
```

```bash
npx vitest run guard.test
```

**3. Put the guards first in CI** (3 minutes). Delete the `integration` job if
you have no database yet.

```bash
mkdir -p .github/workflows .github/scripts && cp ../mainstay/ci/guard-first.yml .github/workflows/ci.yml && cp ../mainstay/ci/should-run.sh .github/scripts/
```

**4. Start the refusal set** (5 minutes, if you ship an agent). Rewrite the
cases for your tools and point `decide` in `refusals.test.ts` at the function
your server calls before it executes a tool call.

```bash
mkdir -p evals && cp ../mainstay/evals/refusals.yaml ../mainstay/evals/refusals.test.ts ../mainstay/evals/cases.ts evals/
```

When you have ten more minutes: the pre-push hook and the CLAUDE.md template
([agent/](agent/)), the integration workflow ([ci/](ci/)), and the day-zero
numbers (`node ../mainstay/metrics/baseline.mjs`, see [metrics/](metrics/)).

## Repository layout

```
mainstay/
  README.md                    the six layers and the setup
  CASE.md                      the reference deployment's numbers and how to reproduce them
  guards/                      guard helpers (Vitest), each with a README and a failing example
    text-guard.ts              a source invariant: grep + allowlist
    surface-guard.ts           "every file in folder X calls Y" (routes → auth, rate limits)
    bundle-guard.ts            forbidden syntax in client bundles
    fail-closed.ts             readers of private data return nothing on error
    ratchet.ts                 a per-file budget that can only go down
    examples/                  one demo per helper, red on purpose
  ci/                          GitHub Actions templates and the scripts they call, all tested
    guard-first.yml            should-run → guards → tests + build → integration
    integration-postgres.yml   a real database, migrations from scratch (service or Supabase CLI)
    deploy-watchdog.yml        is the tip of main deployed? (logic in deploy-watchdog.mjs)
    should-run.sh              skip a push whose file tree already passed on its PR
    migrations/                apply-migrations.sh: one transaction per file, no blind applies
    integration/               ledger drift, RPC smoke and grants tests for a real Postgres
  evals/                       the agent eval kit
    refusals.yaml              ask, call, expected (refuse | card | allow), reason, twin
    refusals.test.ts           the deterministic runner
    sanitize.test.ts           contacts and links stripped from model input and output
    approval-invariant.test.ts every writing tool needs a card; money is dangerous
    reference/                 the registry, router, executor and sanitizer the tests run against
  agent/                       the contract for the coding agent
    CLAUDE.md.template
    pre-push.sh                text guards before every push, no pushes to main
    PR_CHECKLIST.md
  metrics/
    baseline.mjs               PRs, CI time, red share, flaky signal from the GitHub API
    METRICS.md                 the six metrics and their definitions
  examples/next-api/           a two-route app where the surface guard fails on purpose
  mainstay.guard.test.ts       the harness's own guards
```

## Running it

```bash
npm install && npm test
```

The whole suite is green, including the demos. Each demo points a real guard at
code that breaks its rule on purpose, and passes only if the guard reports
exactly the planted violations. To see those failures as they would look in your
CI:

```bash
npm run red
```

```
GuardViolation: 1 violation: every API route checks the session

  app/api/orders/export/route.ts  [require]  does not call requireUser(request)

What to do: call requireUser(request) first and return its response when it fails,
or add the route to `allow` with the reason it is public.
```

The integration templates need an empty Postgres database. Apply the example
migrations, then run the tests against it:

```bash
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_test
export MIGRATIONS_DIR=ci/integration/migrations
ci/migrations/apply-migrations.sh "$TEST_DATABASE_URL"
npm run test:integration
```

The repository's own CI does the same against a Postgres service container
([.github/workflows/test.yml](.github/workflows/test.yml)).

## Anatomy of a guard

Every guard in this repository, and every guard worth keeping, has four parts in
its header and three tests:

- **WHY**: the incident or the rule, with the cost of breaking it.
- **HOW**: what it scans and what counts as a violation.
- **IF IT FAILS**: what to write instead, in one or two sentences.
- **LIMITS**: what it cannot see. A guard that claims too much is trusted too much.

The tests: it sees the files it guards (an empty scan is a broken guard, not a
pass); the rule holds; the allowlist has no dead entries. Allowlist entries carry
a reason a reviewer can check. A red guard is a decision point: fix the code or
write down why this file is the exception. Never loosen the pattern to get green.

**Why guards and not lint rules?** Use a lint rule where an AST rule fits. A guard
is a 20-line test in the language the team already tests in; it can read across
files (an import graph, every reader of a table), SQL and YAML; and its exceptions
live next to the rule, with their reasons.

## The incident-to-guard loop

1. Something breaks in production, or a review finds a class of bug.
2. Find the root cause in the code, not the symptom.
3. Write the guard that would have failed, in the same PR as the fix.
4. The class of failure is closed: the next instance fails CI instead of production.

This repository has its own instance. While it was being written, a tool turned
the escape sequences in a regex into the real invisible characters, which made
two files read differently from how they run. The fix and a guard against
invisible and bidirectional characters landed together
([mainstay.guard.test.ts](mainstay.guard.test.ts)).

## Reference deployment

[Catch Club](CASE.md), a platform for paid Telegram communities, is the private
reference deployment: a web app, bots, mini apps, payments, an MCP server and AI
agents, written in eight months by one engineer with Claude Code. Its product code
is not here. [CASE.md](CASE.md) has its numbers and the commands that reproduce
them.

## Design choices

- **Copy, do not install.** mainstay is templates you copy and own. It is not on
  npm on purpose: no supply chain, no version coupling, and a guard you can read
  in full is a guard you can trust.
- **No runtime dependencies.** The guards need Vitest and Node. The scripts need
  bash 3.2 (the macOS default), git, psql or Node 20+.
- **Every script is tested.** should-run, the migration script, the watchdog, the
  pre-push hook and the metrics script all have tests with stubs; the workflow
  templates have structural checks (no secrets, timeouts, pinned actions,
  contexts used only where GitHub allows them).
- **Deterministic evals.** The agent evals test the server, not the model. Live
  model evals belong in a separate, non-blocking suite.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Kamil Dashdamirov.

---

## Кратко по-русски

mainstay — открытый харнес «системы качества для разработки, где код пишет
агент». Шесть слоёв: гарды инвариантов (тесты, которые читают исходники и падают
при нарушении правила), бюджеты-трещотки (долг по файлам только уменьшается),
гейты в CI (сначала дешёвое: нужен ли прогон, гарды, потом тесты, сборка и
интеграция на настоящей Postgres с миграциями с нуля, сторож деплоя), eval-наборы
для агентов (детерминированный набор отказов, санитайзер ввода и вывода модели,
инвариант «каждая запись — через карточку подтверждения»), контракт для
агента-разработчика (CLAUDE.md, pre-push, чек-лист PR) и цикл «инцидент → гард»
с шестью метриками. Всё на TypeScript и bash, без зависимостей кроме Vitest;
шаблоны копируются в свой репозиторий, а не ставятся из npm. `npm test` зелёный:
демо-гарды падают намеренно и проверяются как «ожидаемо красные»; `npm run red`
показывает настоящие падения. Референсное внедрение — Catch Club (закрытый код),
цифры и команды воспроизведения — в CASE.md. Лицензия MIT.
