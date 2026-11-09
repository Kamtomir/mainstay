---
name: setup
description: Set up the mainstay quality harness in the current repository. Asks which layers to install, copies the guard helpers to test/guards, writes the first guards for this codebase (every API route checks the session; no server keys or regex lookbehind in client code; a ratchet on `as any` and `@ts-ignore` at today's numbers), installs the guards-first CI workflow, the pre-push hook and a CLAUDE.md contract, then runs the guards and reports the findings without fixing anything unasked.
disable-model-invocation: true
---

# Set up mainstay in this repository

mainstay (https://github.com/Kamtomir/mainstay) is a quality harness for
repositories where an agent writes much of the code: tests that read the source
and fail when a rule is broken, run first in CI and before every push. The files
you install are bundled with this skill, a copy of the harness kept identical to
the repository by its tests:

```
${CLAUDE_SKILL_DIR}/harness
```

Copy from that folder; never download the harness. If the line above is not an
absolute path to a folder holding `guards/core.ts`, stop and ask the person for
a local clone of mainstay: its `guards/`, `ci/` and `agent/` folders hold the
same files, so use the clone's root in place of that folder below.

## Ground rules

- Talk to the person in their language. Installed files stay in English, like
  the harness.
- New files: create them once the person has chosen their layer. Never
  overwrite a file that exists: compare, show the difference and ask.
- Existing files (package.json, a test or TypeScript config, a workflow,
  CLAUDE.md, git config): change them only after the person said yes to that
  change.
- Product code: never touch it. A red guard is a finding for the person, not a
  task for you. Fix nothing without an explicit yes for that file or group.
- Do not commit, push or open a pull request unless the person asks.
- A guard that scans nothing, or a budget that does not match today's numbers,
  is your bug, not a finding: fix it before you report.

## 1. Look first, write nothing

Run read-only commands and read files until you know:

- **Repository**: the git root, `git status --short` (a dirty tree makes the
  setup harder to review), the current branch, and the default branch
  (`git symbolic-ref --short refs/remotes/origin/HEAD`, else `main`).
- **Package**: `package.json` and the lockfile, which names the package manager
  (`package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn,
  `bun.lock` or `bun.lockb` bun); the `test`, `typecheck` and `build` scripts;
  the framework (next, vite, @remix-run/*, react-router, @sveltejs/kit, nuxt,
  astro, express, fastify, hono); the test runner (vitest, jest, none); and
  `node -v` (the guards need Node 20+). In a monorepo, ask which package to set
  up.
- **Configs**: the Vitest config and its `include` (the guards live in
  `test/guards/*.guard.test.ts`); `tsconfig.json`: `include`, `paths` (import
  aliases), and the settings the copied helpers do not satisfy:
  `noPropertyAccessFromIndexSignature`, `isolatedDeclarations`, and `module`
  `node16`, `node18`, `node20` or `nodenext` in a package with
  `"type": "module"` (their relative imports carry no file extension).
- **API surface**: where route handlers live, and the call that protected ones
  make to check the session. Read three to five routes; look for the shared
  call (`requireUser(`, `auth(`, `getServerSession(`, `currentUser(`,
  `withAuth(`, `getUser(`). Note routes that look public by design (health,
  webhooks that verify a signature, auth callbacks, crons with a secret). If
  auth happens only in middleware (for example a Next.js `middleware.ts`
  matcher), say so: a per-route guard will report every route.
- **Client code**: how modules reach the browser (`"use client"` in the Next.js
  App Router; the entry in `index.html` for a Vite app; `pages/` outside
  `pages/api` in the Next.js Pages Router) and the public env prefix
  (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `PUBLIC_`).
- **Existing pieces**: `.github/workflows/*.yml` and whether one already runs
  the tests; git hooks (`git config --get core.hooksPath`, `.husky/`,
  `lefthook.yml`, a non-sample `.git/hooks/pre-push`); `CLAUDE.md`, `AGENTS.md`,
  `BACKLOG.md`, `.github/pull_request_template.md`; an earlier `test/guards/`
  (then add only what is missing, and compare its helpers with
  `diff -r "${CLAUDE_SKILL_DIR}/harness/guards" test/guards`).

Stop and explain if this is not a git repository. Without a `package.json` the
guards cannot run (they need Node and Vitest): offer the agent contract alone.

## 2. Ask which layers to install

Use AskUserQuestion. Put what you found into the option descriptions, so the
person decides on facts:

1. multiSelect, "Which mainstay layers should I install?"
   - **Guards**: the helpers in `test/guards` and three guards for this
     codebase: API routes check the session (say how many routes and which
     check), client code has no server keys and no regex lookbehind, and a
     ratchet on `as any` and `@ts-ignore` at today's counts.
   - **CI**: a guards-first GitHub Actions workflow (should-run, guards, then
     typecheck, tests and build).
   - **Agent contract**: CLAUDE.md from the mainstay template, a pre-push hook
     that runs the guards and refuses direct pushes to main or master, and the
     PR checklist.
2. Only when the current branch is the default branch: "Put the setup on a new
   branch `chore/mainstay`?" (recommended) or "Stay on this branch".

Then list every change to an existing file the chosen layers need (adding
Vitest to devDependencies, a Vitest `include` glob, a Jest ignore pattern,
`git config core.hooksPath`, an existing workflow, an existing CLAUDE.md, a new
BACKLOG.md) and ask once, multiSelect, which of them to make. What the person
leaves out, you skip and report.

## 3. Guards

### 3.1 Copy the helpers

```bash
mkdir -p test/guards && cp "${CLAUDE_SKILL_DIR}"/harness/guards/* test/guards/
```

The bundled folder holds the helpers and their README only, without the
examples and the tests. The helpers need Vitest and Node built-ins: add
`vitest` as a dev dependency with the project's package manager if it is
missing. With Jest as the test runner, Vitest runs the guards only: add
`<rootDir>/test/guards/` to Jest's `testPathIgnorePatterns`. When the Vitest
config has an `include` that does not match `test/guards/**`, add
`"test/guards/**/*.guard.test.ts"` to it.

Every guard below follows the harness's anatomy: a header with WHY, HOW, IF IT
FAILS and LIMITS, and a scan that cannot pass on nothing. Roots are relative to
the directory Vitest runs from, the package root. For a rule these three do not
cover, read `${CLAUDE_SKILL_DIR}/harness/guards/README.md`.

### 3.2 Every API route checks the session

`test/guards/routes.guard.test.ts`. Pick the surface by framework:

- Next.js App Router: root `src/app/api` (or `app/api`), files
  `/(^|\/)route\.[jt]sx?$/`. List route handlers outside `app/api` in the
  report: they are endpoints too, and the person may widen the root.
- Next.js Pages Router: root `src/pages/api` (or `pages/api`), files
  `/\.[jt]sx?$/`.
- SvelteKit: root `src/routes`, files `/(^|\/)\+server\.[jt]s$/`.
- Express, Fastify, Hono: the routes folder and its router files; or, when the
  check is middleware passed per route, an `eachCall` rule (see
  `${CLAUDE_SKILL_DIR}/harness/guards/surface-guard.ts`) on `router.get(`,
  `router.post(` and the rest, requiring the middleware's name.
- Anything else: describe the surface you found and ask before writing.

```ts
/**
 * Guard: every API route checks the session.
 *
 * WHY. A route without the check serves its data to anyone who finds the URL.
 * The check is written by hand in every new route, so one forgotten call is a
 * leak that no test of the other routes notices.
 *
 * HOW. Every file under <root> that matches <files> must call <the check>.
 * Comments do not count.
 *
 * IF IT FAILS. Call <the check> first and return its response when it fails,
 * or add the route to `allow` with the reason it is public.
 *
 * LIMITS. It sees that the check is called, not that its result is used.
 */
import { surfaceGuard } from "./surface-guard";

surfaceGuard({
  name: "every API route checks the session",
  root: "src/app/api",
  files: /(^|\/)route\.[jt]sx?$/,
  require: /\brequireUser\(/,
  requirement: "call requireUser(request)",
  mustSee: ["orders/route.ts"],
  allow: {},
});
```

Replace the root, the pattern, the check and `mustSee` (one protected route
that will stay) with what this project uses; `require` takes an array when
several checks are legitimate. Start with an empty `allow`: public routes show
up as findings, and the person gives each its reason.

### 3.3 Client code has no server keys and no regex lookbehind

`test/guards/client-bundle.guard.test.ts`. Skip it, and say so, when nothing in
the repository reaches a browser.

```ts
/**
 * Guard: client code reads no server keys and has no regex lookbehind.
 *
 * WHY. A server environment variable read in client code is undefined in the
 * browser, or, when a build config inlines it, shipped to every visitor. A
 * regex lookbehind makes Safari before 16.4 reject the whole file, so every
 * screen that imports the module fails to load on older iPhones.
 *
 * HOW. Starts from every client entry module, follows its imports inside the
 * source root and checks every module it reaches. Server-only modules may keep
 * both: they are never reached.
 *
 * IF IT FAILS. Read the value on the server and pass down the result; turn a
 * lookbehind into a capture group returned in the replacement.
 *
 * LIMITS. Packages in node_modules are not followed; .vue and .svelte files
 * are not parsed.
 */
import { bundleGuard, LOOKBEHIND, SERVER_ENV } from "./bundle-guard";

bundleGuard({
  name: "client code has no server keys and no regex lookbehind",
  root: "src",
  aliases: { "@/": "" },
  forbid: [LOOKBEHIND, SERVER_ENV],
  mustReach: ["components/Search.tsx", "lib/format.ts"],
});
```

- `aliases` mirror `tsconfig.json` `paths` relative to `root`: `"@/*": ["./src/*"]`
  with root `src` is `{ "@/": "" }`, with root `.` it is `{ "@/": "src/" }`.
- `mustReach`: a client module and a shared module it imports through an alias.
  A broken alias then fails the guard instead of passing on nothing.
- Entries: the default is a `"use client"` directive (Next.js App Router). For a
  Vite or other single-page app pass `isEntry: (rel) => rel === "main.tsx"` (the
  module `index.html` loads); for the Pages Router,
  `isEntry: (rel) => /^pages\/(?!api\/)/.test(rel)`, and note in LIMITS that
  reads inside `getServerSideProps` are reported too.
- `SERVER_ENV` treats `NEXT_PUBLIC_` and `NODE_ENV` as public. For another
  framework, add a rule with the same id for its prefix, for example in Vite:
  `{ id: "server-env", pattern: /\bimport\.meta\.env\.(?!VITE_|MODE\b|DEV\b|PROD\b|SSR\b|BASE_URL\b)[A-Z][A-Z0-9_]*/, message: "server environment variable in client code" }`.

### 3.4 Type escapes only go down

`test/guards/type-escapes.guard.test.ts`. Write it with an empty budget first:

```ts
/**
 * Ratchet: type escapes only go down.
 *
 * WHY. `as any` and `@ts-ignore` switch the type checker off for a line. Each
 * one is a place where a wrong type reaches runtime unnoticed, and an agent
 * pressed for green adds them first.
 *
 * HOW. Counts both in every source file, comments included (`@ts-ignore` is a
 * comment), and compares the count with the budget below.
 *
 * IF IT FAILS. grew: fix the type instead, or raise that file's budget with a
 * comment saying why. shrank: lower the budget to the new count.
 *
 * LIMITS. Counts text: `as any` inside a string counts too.
 */
import { ratchet } from "./ratchet";

ratchet({
  name: "type escapes only go down",
  root: "src",
  patterns: [/\bas any\b/g, /@ts-ignore/g],
  keepComments: true,
  budget: {},
});
```

Take the budget from today's numbers: run it, and every `[grew]` line names a
file and its count. For long lists:

```bash
npx vitest run type-escapes.guard 2>&1 | sed -nE 's/^  (.+)  \[grew\]  ([0-9]+) found, budget 0:.*/      "\1": \2,/p'
```

Paste the lines into `budget: { DEBT: { ... } }` under a comment
`// Baseline <today's date>: debt from before mainstay. It only goes down.`,
check that their number equals the violation count in the failure header, and
run it again: it must be green.

- `root`: the folder with the hand-written code (`src` when it exists). With
  `.` as the root, add `exempt: ["test/guards/"]`: the helpers name both
  patterns in their comments.
- Every file in the budget must be tracked by git (`git ls-files <file>`). A
  generated or ignored file goes into `exempt` instead: it is missing in CI, and
  its budget would fail there.
- No escapes at all: keep `budget: {}`. The guard is green and stays at zero.

## 4. CI

```bash
mkdir -p .github/workflows .github/scripts
cp "${CLAUDE_SKILL_DIR}/harness/ci/guard-first.yml" .github/workflows/ci.yml
cp "${CLAUDE_SKILL_DIR}/harness/ci/should-run.sh" .github/scripts/should-run.sh && chmod +x .github/scripts/should-run.sh
```

If `ci.yml` exists, or another workflow already runs the tests, do not copy
over it. Ask instead: add a `guards` job to that workflow and make its heavy
jobs `needs: guards`, or install the template under a free name. The `WORKFLOW:`
value in the should-run step must equal the installed file name: should-run
looks up green runs of that workflow.

Then adapt the copy, and only these parts:

- Delete the `integration` job. It calls `integration-postgres.yml`, which is
  not installed, and a workflow that calls a missing file fails as a whole.
  Delete the header comment's lines about it, and its "Install:" paragraph.
- `branches: [main]`: the default branch, in both `pull_request` and `push`.
- `cache: npm` and `npm ci`: the project's package manager (pnpm needs
  `pnpm/action-setup@v4` before `actions/setup-node`).
- `node-version: 22`: `node-version-file:` when the repository pins Node
  (`.nvmrc`, `.node-version`).
- The typecheck, test and build commands: the project's scripts.

Keep `paths-ignore` identical in `push` and `pull_request`. No secrets are
needed: the workflow uses its own token.

## 5. Agent contract

**Pre-push hook.** Install it only when guard files exist (this run or an
earlier one): the hook runs `npx vitest run guard.test`, and with no guards
that command fails every push that changes code.

```bash
mkdir -p .githooks && cp "${CLAUDE_SKILL_DIR}/harness/agent/pre-push.sh" .githooks/pre-push && chmod +x .githooks/pre-push
```

Then, with the person's yes, `git config core.hooksPath .githooks`. If hooks
are already managed (`core.hooksPath` set, husky, lefthook), keep the manager:
with husky, a `.husky/pre-push` that runs `.githooks/pre-push`; with lefthook, a
pre-push command with `use_stdin: true`. The hook reads the pushed refs from
standard input. `core.hooksPath` is per clone: say so in the report.

**CLAUDE.md.** Without one, copy the template and fill it in:

```bash
cp "${CLAUDE_SKILL_DIR}/harness/agent/CLAUDE.md.template" CLAUDE.md
```

Replace `{{PROJECT}}` (the package or folder name), `{{GUARD_COMMAND}}`
(`npx vitest run guard.test`, or the package manager's equivalent) and
`{{TEST_COMMAND}}` (the project's test command), and delete the closing "Fill
in ..." paragraph. With a CLAUDE.md in place, never overwrite it: list the
template's sections it lacks and offer to append them under
`## Engineering contract (mainstay)`. If AGENTS.md exists, say that other
agents read that file instead.

**PR checklist.** Copy `${CLAUDE_SKILL_DIR}/harness/agent/PR_CHECKLIST.md` to
`.github/pull_request_template.md` when there is none, without its "Copy into"
paragraph, and point the CLAUDE.md line "Follows agent/PR_CHECKLIST.md" at the
installed path (an existing template, if the repository has one).

**BACKLOG.md.** The contract asks every PR to update it. When it is missing,
the consent question in step 2 offers a skeleton (`## Now`, `## Next`,
`## Done`); without it, tell the person the contract's backlog lines point at
nothing.

## 6. Run the guards and report

```bash
npx vitest run guard.test
```

With pnpm, yarn or bun, use their exec form. Also run the project's typecheck
when it has one. The copied helpers pass `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `verbatimModuleSyntax`; an error in them comes
from a setting like those noted in step 1. When the only errors are in
`test/guards/*.ts`, fix the ones in the guard files you wrote, and if the
copied helpers still fail, offer to exclude `test/guards` from that tsconfig.
Vitest does not type-check, so the guards still run.

Show the findings grouped by guard, as a table: file, line, rule, and what it
means in this codebase. Then ask, per group, what to do:

- **A route without the check**: add the check (a product change), allow it
  with a reason the person confirms ("liveness probe, returns no data",
  "Stripe webhook, verifies the signature"), or keep it red for now.
- **Server keys or lookbehind in client code**: fix (a product change), allow
  with a reason, or keep it red.
- **The ratchet**: green by construction. If it is not, a file changed between
  the two runs: take the numbers again.
- **"sees the files it guards" failed**: a wrong root, pattern or alias. That
  is your mistake: fix the guard and run again.

Apply only what the person approved, run the guards again and show the final
state. Warn that while a guard is red, the CI guards job fails and the pre-push
hook refuses pushes that change code (`git push --no-verify` bypasses it
deliberately).

## 7. Final report

- Layers installed; files added; existing files changed, each with the yes it
  got; what was skipped and why.
- Each guard: what it scans (count), its findings, and the decision on each.
- Not verified yet: the workflow runs on GitHub only after a push; the hook on
  the next push.
- Next steps, by what the repository has: SQL migrations, the integration
  workflow (https://github.com/Kamtomir/mainstay/blob/main/ci/README.md); an
  agent with tools, the refusal eval set
  (https://github.com/Kamtomir/mainstay/blob/main/evals/README.md); day-zero
  numbers from the GitHub API
  (https://github.com/Kamtomir/mainstay/blob/main/metrics/METRICS.md);
  teammates enable the hook with `git config core.hooksPath .githooks`.
- Nothing is committed. Suggest reviewing the diff and committing it on its own
  branch.
