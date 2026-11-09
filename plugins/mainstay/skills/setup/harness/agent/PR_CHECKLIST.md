# PR checklist

Copy into `.github/pull_request_template.md`, or keep it here and link it from
the template. It applies the same way to a PR written by a person and to one
written by an agent: the reviewer checks the boxes against the diff.

## What and why

- [ ] The description says what changed, why, and how each touched file serves that.
- [ ] One logical change. Unrelated fixes are separate PRs or backlog items.
- [ ] BACKLOG.md is updated: done items moved, follow-ups added.

## Tests

- [ ] Every behaviour change has a test of that behaviour.
- [ ] A bug fix includes the test that fails without the fix.
- [ ] A production incident fix includes a guard that closes the class, not
      just this instance.
- [ ] No test was skipped, weakened or deleted to get green. If one was, the
      description says which and why.
- [ ] The text guards passed locally before the push.

## Guards and budgets

- [ ] No guard pattern was loosened. New allowlist entries carry a reason.
- [ ] Ratchet budgets did not grow, or the growth is commented in the budget.
- [ ] Budgets that shrank were lowered.

## Data

- [ ] New migrations are additive and apply to an empty database.
- [ ] New tables and functions have their grants (app role yes, PUBLIC no).
- [ ] A destructive change has a written plan: deploy order, backfill, rollback.

## Security

- [ ] No secrets in code, config, logs or test fixtures.
- [ ] Tokens and credentials the app stores are encrypted at rest.
- [ ] New agent tools: scopes are explicit, writes need a card, money tools are
      dangerous, nothing moves money out through an agent.
- [ ] New readers of private data fail closed.
- [ ] Text from users or the web reaches models as untrusted data.
- [ ] Every action an agent triggers writes an audit entry: who, what, which
      arguments, approved by whom.

## Release

- [ ] Behaviour that must not reach everyone yet is behind a flag or a staged
      release, not an ad-hoc environment check.
- [ ] The rollback is a revert of this PR, or the description says otherwise.
- [ ] What could not be verified (a device, a third-party sandbox, a live
      channel) is listed for a manual check after merge.
