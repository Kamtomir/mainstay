# examples/next-api: a route without auth turns CI red

A minimal app in the Next.js App Router layout with two API routes. One of them
forgot the session check. The surface guard finds it from the source; a runtime
test shows the hole is real.

```
app/api/orders/route.ts          GET /api/orders: calls requireUser(), returns the user's orders
app/api/orders/export/route.ts   GET /api/orders/export: a CSV "for finance", no requireUser()
lib/auth.ts                      requireUser(request): the session check (a demo token here)
lib/orders.ts                    in-memory data, with customer emails
auth.guard.test.ts               the guard: every route under app/api calls requireUser()
routes.test.ts                   the same claim at runtime: an anonymous request gets 401
```

The handlers use only the standard `Request` and `Response`, so the example runs
under Vitest without installing Next.js, and the folder drops into any Next.js 13+
app as it is.

## The guard

```ts
surfaceGuard({
  name: "every API route checks the session",
  root: app,
  files: /^app\/api\/.+\/route\.ts$/,
  require: /\brequireUser\(/,
  requirement: "call requireUser(request)",
  minFiles: 2,
});
```

In your repository that is the whole guard. Here it sits inside `expectRed()`,
so `npm test` stays green while proving the guard fails for exactly this route.

## Expected red output

```bash
npm run red -- examples/next-api
```

```
FAIL  examples/next-api/auth.guard.test.ts > every API route checks the session > every surface file follows the rule (call requireUser(request))
GuardViolation: 1 violation: every API route checks the session

  app/api/orders/export/route.ts  [require]  does not call requireUser(request)

What to do: call requireUser(request) first and return its response when it fails, or add the route to `allow` with the reason it is public.

FAIL  examples/next-api/routes.test.ts > an anonymous request gets 401 from every route > app/api/orders/export/route.ts
AssertionError: an anonymous request must be rejected with 401: expected 200 to be 401 // Object.is equality
```

The runtime test also checks that the 200 carries customer emails: the guard
found a data leak, not a style issue.

## The fix

```ts
export async function GET(request: Request): Promise<Response> {
  const auth = requireUser(request);
  if (!auth.ok) return auth.response;
  const rows = listOrders(auth.user.workspaceId).map((o) => [o.id, o.customerEmail, o.total].join(","));
  return new Response(["id,email,total", ...rows].join("\n"), { headers: { "content-type": "text/csv" } });
}
```

Note the second change: the workspace comes from the session, not from the query
string. A route that checks the session but trusts `?workspace=` is the next
guard to write ("no route reads the workspace from the URL").

## Why both a guard and a runtime test

The runtime test covers the routes that exist today. The guard covers the route
someone adds next month: it joins the surface by its path, and nobody has to
remember to add a test for it.
