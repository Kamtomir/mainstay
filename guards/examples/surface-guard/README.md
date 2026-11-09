# surface-guard example: rate limits on admin routes name their store

**The rule.** Every `rateLimit(` call under `api/admin/` passes
`{ store: "global" }`, unless it runs inside `withTenant(...)`.

**Why.** Admin routes run outside any tenant. A limiter called there without an
explicit store looks for its counter table in the tenant's schema, the lookup
fails, and the limiter fails open: every request is allowed. In the reference
deployment the limit on one sign-in endpoint never applied at all, and no test
noticed, because the limiter was mocked everywhere.

**How it works.** The `eachCall` form of the surface guard. The surface is every
`route.ts` under `api/admin/`. For each `rateLimit(` call the guard reads the
call's own parentheses, across lines, and wants `store: "global"` there. A call
with `withTenant(` on its line or the two lines above is fine: counting in the
tenant's store is the point there.

For the other form, "every file of the surface makes a required call", see
[examples/next-api](../../../examples/next-api/).

## Files

- [rate-limit-store.guard.test.ts](rate-limit-store.guard.test.ts): the guard on
  both fixtures.
- [fixture/bad](fixture/bad): a one-line call and a multi-line call without the
  store, a multi-line call with it, and a call inside `withTenant`.
- [fixture/good](fixture/good): every call names its store.

## Expected red output

```
GuardViolation: 2 violations: rate limits on admin routes name their store (bad fixture)

  api/admin/invites/route.ts:4  [each-call]  call does not pass { store: "global" }
        const limit = await rateLimit(request, "admin_invite", { max: 5, window: "1m" });
  api/admin/reports/route.ts:5  [each-call]  call does not pass { store: "global" }
        const limit = await rateLimit(request, "admin_report", {

What to do: make the file follow the rule, or add it to `allow` with the reason it is safe without it.
```

## Limits

A text heuristic: a `withTenant(` further than two lines above the call is not
seen (`contextLines` widens it). Better: move the call into the callback, where
the guard and the reader both see it.
