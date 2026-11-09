/**
 * Guard: `void` in front of a lazy query builder is not a background write, it
 * is no write at all.
 *
 * WHY. Query builders in supabase-js, Knex, Kysely and Drizzle are lazy
 * thenables: the request leaves only inside then(). `void db.from("t").insert(row)`
 * builds the request and throws it away. No network call, no error, and tests
 * with a mocked client stay green. The reference deployment found four writes
 * that had never run once this way.
 *
 * HOW. A text guard over code with comments blanked: `void`, then a chain from
 * the client name to `.from(` or `.rpc(`, across line breaks.
 *
 * IF IT FAILS. `await` the call when the write must finish before the response;
 * hand it to the platform's after-response hook (`after()` in Next.js,
 * `waitUntil()` on workers) when it must not delay it; delete the line when the
 * write is not needed. It never ran anyway.
 *
 * LIMITS. A chain broken by a variable (`const q = db.from("t"); void q.insert()`)
 * is not seen; `void Promise.all([...])` sends its requests and is a different
 * class (nobody waits for them).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { expectRed } from "../../expect-red";
import { textGuard, type TextRule } from "../../text-guard";
import { createClient } from "./lazy-builder";

const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url));

const VOID_BUILDER: TextRule = {
  id: "void-builder",
  pattern: /(?<![\w$.])void\s+\(?\s*db(?:\s*\??\.\s*[A-Za-z_$][\w$]*|\s*(?:\?\.)?\([^()]*\))*?\s*\??\.\s*(?:from|rpc)\s*\(/,
  message: "`void` drops a lazy query: the request is never sent. await it, or pass it to after()",
};

describe("premise: a lazy builder sends nothing until it is awaited", () => {
  // If the library ever starts sending eagerly, this fails first and the guard
  // below can be retired. Pin the premise a guard relies on.
  it("void sends nothing, await sends once", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const db = createClient(send);
    void db.from("audit_log").insert({ event: "login" });
    await new Promise((r) => setTimeout(r, 10));
    expect(send).not.toHaveBeenCalled();
    await db.from("audit_log").insert({ event: "login" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// The real guard on code that breaks the rule on purpose: expected red.
expectRed(["jobs/cleanup.ts:6", "routes/login.ts:5"], () =>
  textGuard({
    name: "void never fires a lazy query builder (bad fixture)",
    root: fixture("bad"),
    rules: [VOID_BUILDER],
    allow: {
      "legacy/export.ts": "cache warm-up the product decided to drop; removal tracked in the backlog",
    },
    minFiles: 3,
  }),
);

// The same guard on the fixed code: green.
textGuard({
  name: "void never fires a lazy query builder (good fixture)",
  root: fixture("good"),
  rules: [VOID_BUILDER],
  minFiles: 3,
});
