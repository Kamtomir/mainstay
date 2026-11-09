# ratchet example: ad-hoc edition checks only go down

**The rule.** Outside the flag registry, the number of `isEnterprise()` and
`process.env.EDITION` checks in each file equals its budget. New behaviour that
must not reach everyone yet goes behind a named flag (`isFeatureOn(key)`).

**Why.** In the reference deployment, improvements built for the flagship
customers never reached the others: each one hid behind its own ad-hoc
deployment check, the safe choice in the moment that nobody decided on purpose.
The fix was a release registry the operator switches without a deploy, and this
budget for the checks that remained.

**How it works.** The ratchet counts the patterns in every file outside `flags/`
(the registry, where they belong) and compares the count with the budget, grouped
by category so the review says why each check exists:

- *grew*: new debt. Use the registry, or raise that file's budget with a comment
  saying why; the reviewer sees the decision in the budget's diff;
- *shrank*: debt was paid down. Lower the budget, so the next PR cannot quietly
  spend it again;
- a budget for a file that no longer exists fails the dead-entries test.

## Files

- [edition-checks.guard.test.ts](edition-checks.guard.test.ts): the ratchet on
  both fixtures.
- [fixture/bad](fixture/bad): a settings page added a new check; the digest moved
  to the registry but its budget was not lowered.
- [fixture/good](fixture/good): settings uses the registry; the budget matches.

## Expected red output

```
GuardViolation: 2 violations: ad-hoc edition checks only go down (bad fixture)

  emails/digest.ts  [shrank]  0 found, budget 1: debt was paid down. Remove the file from the budget so it cannot come back
  pages/settings.tsx  [grew]  1 found, budget 0: new debt. Use the sanctioned way, or raise the budget here with a comment saying why

What to do: grew: write it the sanctioned way instead, or raise that file's budget with a comment the reviewer can judge. shrank: lower the budget to the new count.
```

## Other debts worth a ratchet

`as any` and `@ts-ignore`, `eslint-disable` lines, `it.skip`, direct SQL outside
the data layer, `console.log` in server code, TODOs without a ticket.

## Limits

It counts text. An alias (`const ent = isEnterprise`) is one match and its calls
are none: keep the patterns to the forms the codebase uses, and add a text guard
against the alias if it starts to appear.
