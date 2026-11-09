#!/usr/bin/env bash
#
# should-run.sh: decides whether the heavy CI jobs must run for this event.
#
# WHY. A push to main after a squash merge carries code that CI has just checked
# on the PR branch. Running the whole pipeline again repeats the same check on
# the same bytes. In the reference deployment such runs were 44% of all CI
# minutes on a private repository, where minutes are billed.
#
# WHAT IS COMPARED. Not the commit SHA (a squash commit always gets a new one)
# and not the diff: the TREE, the hash of the file tree. If the squash commit's
# tree equals the tree of the PR head, and that head has a green run, the build
# and the tests would see exactly the same files. There is nothing to repeat.
#
# WHEN IT RUNS ANYWAY. The PR was behind main and the squash mixed its changes
# with other merges. That combination was never tested, so it runs.
#
# DO NOT BREAK THE DIRECTION OF DOUBT. Many hosts deploy main on push without
# waiting for CI. This run does not protect production; it detects a broken
# main after the fact so a person can roll back. So every uncertainty means
# run: no PR, no green run found, an API error. A redundant run costs minutes;
# a skipped one can hide a broken production.
#
# INPUTS (environment):
#   REPO      owner/name             (github.repository)
#   EVENT     push | pull_request…   (github.event_name)
#   SHA       the commit under test  (github.sha)
#   WORKFLOW  workflow file name, default ci.yml
#   GH_TOKEN  a token that can read pulls and actions (github.token)
# OUTPUT: run=true or run=false appended to $GITHUB_OUTPUT (stdout when unset).
#
# Works with bash 3.2 (macOS) and needs only the gh CLI.
set -euo pipefail

REPO="${REPO:?REPO is required (github.repository)}"
EVENT="${EVENT:?EVENT is required (github.event_name)}"
SHA="${SHA:?SHA is required (github.sha)}"
WORKFLOW="${WORKFLOW:-ci.yml}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

# The reasoning goes to stderr, the value to the output file.
log() { printf '%s\n' "$*" >&2; }

run_ci()  { log "DECISION: run. $1";  printf 'run=true\n'  >>"$OUT"; exit 0; }
skip_ci() { log "DECISION: skip. $1"; printf 'run=false\n' >>"$OUT"; exit 0; }

# A pull request is the first check of the code: that is what CI is for.
[[ "$EVENT" == "push" ]] || run_ci "Event is $EVENT, not a push to main."

# The PR behind this commit. GitHub keeps the link itself, so there is no need
# to parse "(#123)" out of a message that a person may have rewritten.
pr="$(gh api "repos/$REPO/commits/$SHA/pulls" --jq '.[0].number // empty' 2>/dev/null || true)"
[[ -n "$pr" ]] || run_ci "Commit $SHA is not linked to a PR: a direct push to main, never checked on a branch."

pr_head="$(gh api "repos/$REPO/pulls/$pr" --jq '.head.sha // empty' 2>/dev/null || true)"
[[ -n "$pr_head" ]] || run_ci "Could not read the head of PR #$pr."

main_tree="$(gh api "repos/$REPO/commits/$SHA" --jq '.commit.tree.sha // empty' 2>/dev/null || true)"
pr_tree="$(gh api "repos/$REPO/commits/$pr_head" --jq '.commit.tree.sha // empty' 2>/dev/null || true)"
[[ -n "$main_tree" && -n "$pr_tree" ]] || run_ci "Could not read the file trees (main='$main_tree', PR='$pr_tree')."

[[ "$main_tree" == "$pr_tree" ]] || run_ci "The main tree ($main_tree) differs from PR #$pr ($pr_tree): the squash mixed in other changes, untested."

# Same tree, but was there a GREEN run on it? A PR can be merged with a red or
# cancelled run, and skipping then would throw away the only signal. Cancelled
# runs are common: with cancel-in-progress, the previous push's run is cancelled.
green="$(gh api "repos/$REPO/actions/workflows/$WORKFLOW/runs?head_sha=$pr_head&per_page=100" \
  --jq '[.workflow_runs[] | select(.conclusion == "success")] | length' 2>/dev/null || true)"
[[ "${green:-}" =~ ^[0-9]+$ ]] || green=0
(( green > 0 )) || run_ci "No green CI run on the head of PR #$pr ($pr_head)."

skip_ci "Tree $main_tree already passed CI on PR #$pr (head $pr_head)."
