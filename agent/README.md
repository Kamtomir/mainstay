# agent

The contract for the coding agent: the rules it reads on every task, and two
mechanical checks that hold whether it read them or not.

| File | What it is |
|---|---|
| [CLAUDE.md.template](CLAUDE.md.template) | Quality rules only: inspect first, never commit to main, every PR updates the backlog and comes with tests, a red guard is a decision point, migrations replay from scratch, security constraints as conditions. Claude Code reads `CLAUDE.md`; for other agents, copy it to `AGENTS.md` too. |
| [pre-push.sh](pre-push.sh) | Refuses a push to main; runs every text guard when code changed. |
| [PR_CHECKLIST.md](PR_CHECKLIST.md) | What the reviewer checks against the diff, the same for a person's PR and an agent's. |

## Installing

```bash
cp ../mainstay/agent/CLAUDE.md.template CLAUDE.md
```

Fill in the three placeholders, then add your product rules in their own section
or in docs/, linked from the backlog. Keep the two apart: quality rules change
rarely, product rules change every week.

```bash
mkdir -p .githooks && cp ../mainstay/agent/pre-push.sh .githooks/pre-push && chmod +x .githooks/pre-push && git config core.hooksPath .githooks
```

`git config core.hooksPath` is per clone: put the line in the setup script or
the README of your repository. Each agent worktree inherits it from the clone.

## Why the hook runs every guard

Guards that read the whole tree live far from the code they protect. An edit to
a page breaks a guard in `lib/`, and "run the tests of the feature" never runs
it; CI fails twenty minutes later. The guards need no database and no build, so
all of them run in seconds. The tests in [pre-push.test.ts](pre-push.test.ts)
cover the push to main, a code change, a failing guard, a docs-only push, a
branch deletion and a new branch.

## Why rules as conditions

"Try to keep secrets out of the code" is a wish; an agent weighs it against the
task. "Secrets are never stored in plaintext; code that breaks this does not
merge" is a condition, and the review has something to check. Each condition in
the template either has a mechanical check in this repository (a guard, an eval,
a CI gate) or a line in the PR checklist.
