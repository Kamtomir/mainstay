# The six metrics

A quality system needs a day-zero baseline, or nobody can tell whether it
helped. These six are cheap to collect, hard to game alone, and useful read
together. `metrics/baseline.mjs` computes four of them from the GitHub API and
counts the fifth from a label; the sixth comes from your error tracker.

| Metric | What it tells you | Source | In baseline.mjs |
|---|---|---|---|
| Escaped defects | What the checks let through | Issue label | Count of labelled issues |
| Flaky share | Whether people can trust a red run | Actions API, test reporter | Run level |
| CI time | How long feedback takes | Actions API | Yes |
| Red-to-green time | How long main stays broken | Actions API | Yes |
| Share of PRs with tests | Whether changes arrive with tests | PR files | Yes |
| Time to detect production errors | How fast the team learns about a failure | Error tracker, watchdog | No |

Common rules: a rolling 30-day window, a snapshot every week, the same
definitions before and after any change you want to evaluate.

## 1. Escaped defects

**Definition.** A defect found in production (by a user, support, monitoring or
the error intake) that a check before merge could reasonably have caught.
Counted per week, split by class: data, permissions, money, UI, integration.

**Not counted.** A defect in a feature that has not shipped yet, a third-party
outage, a request for new behaviour.

**How to collect.** At triage, label the issue `escaped-defect` and a class
label. `baseline.mjs` counts labelled issues opened in the window
(`ESCAPED_LABEL`). Each one should end with a guard or a test in the PR that
fixes it: that is the incident-to-guard loop.

**Pitfall.** Without labelling discipline the number reads zero and means
nothing. Count the issues you looked at, not only the ones you labelled.

## 2. Flaky share

**Definition.** The share of tests whose result changes without a code change.

- *Test level:* tests that both passed and failed on the same commit in the
  window, divided by all tests that ran. Needs the test reporter's history
  (JUnit XML artifacts, a flaky-test dashboard).
- *Run level* (what `baseline.mjs` reports): commits whose runs of one workflow
  both failed and passed, plus runs that turned green on a re-run, divided by
  all commits with completed runs. A lower bound for the test-level number.

**Target.** Below 1% of tests.

**Pitfall.** A quarantine without an owner and a date becomes a graveyard of
tests nobody runs.

## 3. CI time

**Definition.** Wall-clock time from the start of a CI run to its end, for runs
that did the work: median and p90, per workflow. Track the time to the first
guard result separately; it is the feedback an author waits for.

**How to collect.** `baseline.mjs` uses `run_started_at` to `updated_at`. With a
should-run gate, set `MIN_RUN_MINUTES` just above the gate's own duration:
green runs shorter than that are counted as gated and left out of the timing
and of the red share.

**Target.** Full pipeline under 20 minutes, first guard result under 2.

**Pitfall.** Queue time is not part of `run_started_at`. Long queues need more
runners, not faster tests.

## 4. Red-to-green time

**Definition.** On the default branch, the time from the first failing run to
the next green run: one red spell. Median and maximum over the window, plus
whether main is red right now.

**How to collect.** `baseline.mjs`, from push runs on `BRANCH`.

**Why it matters.** Everyone who branches from a red main inherits the breakage
and loses time telling it apart from their own.

## 5. Share of PRs with tests

**Definition.** Merged PRs that change code and at least one test file, divided
by merged PRs that change code. Docs-only PRs are left out.

**How to collect.** `baseline.mjs`, from the files of each merged PR
(`TEST_PATTERN`, `DOCS_PATTERN`, up to `MAX_PRS` PRs).

**Pitfall.** A changed test file is not proof of a test for the change. Read it
next to escaped defects, and do not push it to 100% by force: a refactor or a
config change can rightly ship without a new test.

## 6. Time to detect production errors

**Definition.** From the moment a production error first happens (its first
occurrence, or the deploy that introduced it) to the moment a person is alerted
or a ticket exists. Median per week, per class.

**How to collect.** From the error tracker: first seen to first alert or issue.
One class is covered by `ci/deploy-watchdog.yml`: a merge that never reached
production is reported within the threshold plus the schedule interval.
`baseline.mjs` does not compute this metric.

## Reading them together

- Escaped defects down while the share of PRs with tests stays flat: the guards
  are doing the work. Up: look at the class, then add the guard.
- CI time down while the flaky share goes up: someone parallelised tests that
  share state.
- Red-to-green time long while the red share is low: main rarely breaks, but
  nobody owns it when it does.

## What baseline.mjs does not do

- It does not page through more than `maxPages` × 100 items per list (1,000 by
  default), and the Actions API caps filtered run lists at 1,000 results.
- It counts what GitHub records. Work done outside pull requests, or CI outside
  GitHub Actions, is invisible to it.
- It needs a token with read access to contents, pull requests, actions and
  issues. A public repository works without one, within the anonymous rate limit.
