#!/usr/bin/env bash
#
# pre-push: every text guard before every push, and no direct pushes to main.
#
# WHY. Guards that read the whole tree live far from the code they protect: an
# edit to a page breaks a guard that sits in lib/, and "run the tests of the
# feature" never runs it. CI then fails twenty minutes later and the push has
# to happen again. The guards need no database and no build, so all of them
# run here in seconds. In the reference deployment this is the habit that saved
# the most CI cycles.
#
# The hook also refuses a push to a protected branch: changes reach main
# through a reviewed PR, whether a person or an agent wrote them.
#
# INSTALL (once per clone)
#   mkdir -p .githooks
#   cp agent/pre-push.sh .githooks/pre-push && chmod +x .githooks/pre-push
#   git config core.hooksPath .githooks
#
# BYPASS, deliberately (a WIP branch, an emergency):  git push --no-verify
#
# SETTINGS (environment)
#   MAINSTAY_GUARDS      the command to run   (default: npx vitest run guard.test)
#   MAINSTAY_SKIP_PATHS  changes that never need the guards, as an extended regex
#                        (default: ^docs/|\.md$)
#   MAINSTAY_PROTECTED   branches nobody pushes to directly (default: main master)
#
# Works with bash 3.2 (macOS).
set -euo pipefail

GUARDS="${MAINSTAY_GUARDS:-npx vitest run guard.test}"
SKIP_PATHS="${MAINSTAY_SKIP_PATHS:-^docs/|\.md$}"
PROTECTED="${MAINSTAY_PROTECTED:-main master}"
ZERO=0000000000000000000000000000000000000000

changed=""
# git passes one line per pushed ref: <local ref> <local sha> <remote ref> <remote sha>
while read -r local_ref local_sha remote_ref remote_sha || [[ -n "${local_ref:-}" ]]; do
  [[ -n "${local_ref:-}" ]] || continue
  branch="${remote_ref#refs/heads/}"
  if [[ "$local_sha" != "$ZERO" ]]; then
    for p in $PROTECTED; do
      if [[ "$branch" == "$p" ]]; then
        echo "[pre-push] refusing to push to $p directly: push a feature branch and open a PR (or git push --no-verify)." >&2
        exit 1
      fi
    done
  fi
  [[ "$local_sha" == "$ZERO" ]] && continue # deleting a remote branch: nothing to check
  if [[ "$remote_sha" == "$ZERO" ]]; then
    # A new branch: compare with where it left main, or check everything.
    base="$(git merge-base "$local_sha" origin/main 2>/dev/null || true)"
  else
    base="$remote_sha"
  fi
  if [[ -n "$base" ]] && git cat-file -e "$base^{commit}" 2>/dev/null; then
    changed="$changed$(git diff --name-only "$base" "$local_sha")"$'\n'
  else
    changed="$changed(no base to compare with)"$'\n'
  fi
done

code="$(printf '%s' "$changed" | grep -v -E "$SKIP_PATHS" | grep -v '^$' || true)"
if [[ -z "$code" ]]; then
  echo "[pre-push] only docs changed: guards skipped."
  exit 0
fi

echo "[pre-push] running the text guards: $GUARDS"
if ! eval "$GUARDS"; then
  echo "[pre-push] a guard failed. Fix it before pushing: CI would fail the same way, later." >&2
  exit 1
fi
