# guards

A guard is a test that reads the source and fails when a rule is broken. It runs
with the unit tests on every PR, needs no database and no build, and does not
care whether a person or an agent wrote the code.

Five helpers cover most project invariants. Each registers a Vitest suite with
the same three tests: it sees the files it guards, the rule holds, and its
allowlist or budget has no dead entries.

| Helper | The rule as a sentence | Example |
|---|---|---|
| [`textGuard`](text-guard.ts) | "This text never appears in that code." | [`void` never fires a lazy query builder](examples/text-guard/) |
| [`surfaceGuard`](surface-guard.ts) | "Every file of this surface calls Y" or "every call of X passes Z." | [rate limits on admin routes name their store](examples/surface-guard/), [every route checks the session](../examples/next-api/) |
| [`bundleGuard`](bundle-guard.ts) | "Nothing that reaches the browser contains this syntax." | [no regex lookbehind in client bundles](examples/bundle-guard/) |
| [`readerGuard`, `failClosedGuard`](fail-closed.ts) | "Every reader of private data applies the filter, and returns nothing when its source fails." | [profile readers fail closed](examples/fail-closed/) |
| [`ratchet`](ratchet.ts) | "This debt only goes down, file by file." | [ad-hoc edition checks only go down](examples/ratchet/) |

Each helper also exports a pure scanner (`scanText`, `scanSurface`,
`scanBundle`, `scanReaders`, `scanRatchet`) that returns a report without any
assertion, for scripts and for tests of your own.

## Copying them

The helpers need Vitest and Node built-ins, nothing else. Copy the folder
without the examples and the tests:

```bash
rsync -a --exclude examples --exclude '*.test.ts' guards/ ../your-repo/test/guards/
```

Name guard files `*.guard.test.ts`. Then `npx vitest run guard.test` runs all of
them, in CI as a first stage and locally before every push (agent/pre-push.sh).
A substring filter needs no quoting, even for paths with `[id]` or `(group)`.

## Writing one

1. **State the rule as a sentence** and the incident behind it. If you cannot,
   it is not a guard yet.
2. **Pick the helper** whose sentence fits. When none does, write a plain test
   with `readSources` and `stripComments` from [core.ts](core.ts).
3. **Header with four parts**: WHY (the incident and its cost), HOW (what counts
   as a violation), IF IT FAILS (what to write instead), LIMITS (what it cannot see).
4. **Make it unable to pass on nothing**: `minFiles`, `mustSee` or `mustReach`.
   A guard whose root moved or whose regex broke otherwise goes green silently.
5. **Pin the premise** when the guard relies on a library's behaviour, like the
   text-guard example does for lazy builders. If the library changes, the
   premise test fails first and tells you the guard can go.
6. **Exempt with a reason**. An allowlist entry without a reason throws; one that
   no longer matches fails the suite.

Comments are blanked before matching (line numbers stay the same), so a rule can
be explained in words right next to the code it forbids. Strings, template
literals and regex literals are kept as written.

## The demos are red on purpose

Every folder in [examples/](examples/) runs a real guard against a fixture that
breaks the rule, wrapped in `expectRed([...planted violations], () => ...)`.
Inside it, the "rule holds" test passes only if the guard reports exactly the
planted violations: the demo proves the guard fails for the right reason. A
bare `it.fails` would pass on any crash.

```bash
npm run red
```

switches the inversion off and shows the failures as your CI would. You never
need `expectRed` in your own repository.
