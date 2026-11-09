# bundle-guard example: no regex lookbehind in client bundles

**The rule.** No module that reaches the browser contains `(?<=` or `(?<!`.

**Why.** Safari before 16.4 does not support regex lookbehind. A regex literal
with one is a syntax error for the whole file, so the chunk does not run at all:
one helper takes down every screen that imports it. In-app browsers on iOS use the
system WebKit, and older iPhones stay on iOS 15. Bundlers do not rewrite the
syntax. In the reference deployment, a lookbehind in a shared sanitizer broke the
home screen for those users; the reports came through the browser error intake,
and this guard landed in the same PR as the fix.

**How it works.** The guard starts from every module with a `"use client"`
directive, follows static, side-effect and dynamic imports inside the source root
(the `@/` alias and relative paths, `.js` specifiers resolved to `.ts`), and
checks every module it reaches, for literals and for strings passed to
`new RegExp`. Type-only imports are skipped: the compiler erases them.

## Files

- [client-lookbehind.guard.test.ts](client-lookbehind.guard.test.ts): the guard
  on both fixtures, with `mustReach` proving the import walk works.
- [fixture/bad](fixture/bad): a client component that imports a highlighter with
  a lookbehind literal (alias import) and a date parser with a lookbehind string
  (dynamic import). A server-only module keeps its lookbehind and is not flagged.
- [fixture/good](fixture/good): both rewritten with a capture group.

## Expected red output

```
GuardViolation: 2 violations: client bundles contain no regex lookbehind (bad fixture)

  lib/dates.ts:2  [regex-lookbehind]  regex lookbehind: Safari before 16.4 cannot parse the file and the whole chunk fails to load
        const YEAR = new RegExp("(?<!\\d)(19|20)\\d{2}(?!\\d)");
  lib/highlight.ts:2  [regex-lookbehind]  regex lookbehind: Safari before 16.4 cannot parse the file and the whole chunk fails to load
        const TAG = /(?<=^|\s)#(\w+)/g;

What to do: rewrite the code in a client-safe form, or stop importing the module from client code. A lookbehind becomes a capture group returned in the replacement: /(^|\s)x/ with "$1".
```

## The fix

```ts
// before: the character before the tag is a lookbehind
const TAG = /(?<=^|\s)#(\w+)/g;
text.replace(TAG, "<mark>#$1</mark>");

// after: it is a group, returned in the replacement
const TAG = /(^|\s)#(\w+)/g;
text.replace(TAG, "$1<mark>#$2</mark>");
```

## More rules

`SERVER_ENV` (a server environment variable read in client code) and
`NODE_BUILTIN` (`node:` imports, `fs`, `child_process`) ship with the helper:
`forbid: [LOOKBEHIND, SERVER_ENV, NODE_BUILTIN]`.

## Limits

Packages in `node_modules` are not followed. A module reached only through a
re-export with a computed path is not seen.
