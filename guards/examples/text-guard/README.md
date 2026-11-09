# text-guard example: `void` never fires a lazy query builder

**The rule.** `void db.from("audit_log").insert(row)` sends nothing. Await the
query, hand it to the platform's after-response hook, or delete the line.

**Why.** Query builders in supabase-js, Knex, Kysely and Drizzle are lazy
thenables: the request leaves only inside `then()`. `void` builds the request and
throws it away. There is no network call and no error, and tests with a mocked
client stay green. In the reference deployment a sweep found four writes that had
never run once: a login timestamp, a click counter, a role self-heal and a
cleanup job.

**How it works.** A text rule over code with comments blanked: `void`, then a
chain from the client's name to `.from(` or `.rpc(`, across line breaks.

## Files

- [void-builder.guard.test.ts](void-builder.guard.test.ts): the premise test, the
  guard on the bad fixture (expected red) and on the good one (green).
- [lazy-builder.ts](lazy-builder.ts): a ten-line lazy builder for the premise.
- [fixture/bad](fixture/bad): two violations and one allowlisted legacy file.
- [fixture/good](fixture/good): the same code, awaited or passed to `after()`.

## Expected red output

`npm run red` on the bad fixture:

```
GuardViolation: 2 violations: void never fires a lazy query builder (bad fixture)

  jobs/cleanup.ts:6  [void-builder]  `void` drops a lazy query: the request is never sent. await it, or pass it to after()
        void db.from("sessions").delete().lt("expires_at", now);
  routes/login.ts:5  [void-builder]  `void` drops a lazy query: the request is never sent. await it, or pass it to after()
        void db

What to do: fix the code, or add the file to `allow` with the reason a reviewer can check. Do not loosen the pattern to get green.
```

The comment on line 5 of `jobs/cleanup.ts` quotes the forbidden code and does not
count. `legacy/export.ts` is in the allowlist with its reason and does not count
either.

## Pin the premise

The guard is only right while builders stay lazy. The premise test runs a lazy
builder with `void` and with `await` and checks that only `await` sends. If your
library ever starts sending eagerly, that test fails first, and the guard can be
retired.

## Limits

A chain broken by a variable (`const q = db.from("t"); void q.insert(row)`) is
not seen. `void Promise.all([...])` does send its requests; nobody waits for them,
which is a different class.

## Adapt it

Replace `db` in the pattern with your client names, for example
`(?:db|supabase|knex|trx)`.
