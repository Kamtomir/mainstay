# fail-closed example: profile readers fail closed

**The rule.** Every reader of `profiles` applies the visibility filter, and a
reader returns nobody when its data source fails.

**Why.** Two classes of leak, both invisible to tests with a healthy mock.

1. *A copy of the rule in every reader drifts.* In the reference deployment, an
   item the owner had rejected stayed visible in a digest, a home feed and a bot
   answer, because only 20 of the 42 files that read its table knew about the
   status column. A guard now makes every new reader decide.
2. *Fail open.* The settings lookup times out, the code falls back to "visible"
   or to the last good list, and a person who hid their profile shows up again.

**How it works.**

- `readerGuard` (static): each statement that reads `profiles` must contain
  `.eq("visibility", "members")` or go through `visibleProfiles()`, or the file
  sits in the allowlist with a reason (the moderation queue must see hidden
  profiles). An exemption for a file that no longer reads the table fails too.
- `failClosedGuard` (runtime): the reader runs against a source that throws,
  rejects, returns an error, returns nothing, returns `undefined`, and returns a
  row without a visibility flag. It must return `[]` every time.

## Files

- [profile-readers.guard.test.ts](profile-readers.guard.test.ts): both checks.
- [fixture/src](fixture/src): five readers; the weekly digest forgot the filter.
- [readers.ts](readers.ts): the same reader written fail-open and fail-closed.

## Expected red output

The static check:

```
GuardViolation: 1 violation: every reader of profiles applies the visibility filter

  digest/weekly.ts:5  [reader]  reads the source without .eq("visibility", "members") or visibleProfiles()
        const { data } = await db.from("profiles").select("id, name, joined_at").gte("joined_at", since);

What to do: apply .eq("visibility", "members") or visibleProfiles(), or add the file to `allow` with the reason the unfiltered read is safe there.
```

The runtime check, for each of the six failure modes of the fail-open reader:

```
AssertionError: the reader must fail closed: on any failure it returns nothing: expected [ { id: 'u1', …(2) } ] to deeply equal []

- Expected
+ Received

- []
+ [
+   {
+     "id": "u1",
+     "name": "Hid their profile yesterday",
+     "visibility": "members",
+   },
+ ]
```

## The fix

```ts
// fails open: the last good list on error, and a missing flag counts as visible
if (error || !data) return lastGood;
return data.filter((row) => row.visibility !== "hidden");

// fails closed: nobody on error, and only an explicit "members" is visible
if (!result || result.error || !Array.isArray(result.data)) return [];
return result.data.filter((row) => row.visibility === "members");
```

## Limits

The static check reads one statement, up to its `;`. A query assembled across
several statements (`q = q.eq(...)`) is not seen; `scope: "file"` accepts the
filter anywhere in the file when reads go through a local helper.
