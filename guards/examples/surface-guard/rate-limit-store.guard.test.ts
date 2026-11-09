/**
 * Guard: every rate-limit call on admin routes names its store.
 *
 * WHY. Admin routes run outside any tenant. A limiter called there without
 * `store: "global"` looks for its counter table in the tenant's schema, the
 * lookup fails, and the limiter fails open: every request is allowed. In the
 * reference deployment the limit on one sign-in endpoint never applied at all,
 * and no test noticed: the limiter was mocked everywhere.
 *
 * HOW. A surface guard over `api/admin/**`: each `rateLimit(` call must pass
 * `store: "global"` inside its own parentheses, unless the call sits inside
 * `withTenant(` (on its line or the two lines above), where the tenant's store
 * is the point. The guard checks itself: it must find the calls.
 *
 * IF IT FAILS. Pass `{ store: "global" }`. If the limit really should count per
 * tenant, move the call inside `withTenant(...)`.
 *
 * LIMITS. A text heuristic: a `withTenant(` further than two lines above the
 * call is not seen. Move the call into the callback explicitly.
 */
import { fileURLToPath } from "node:url";
import { expectRed } from "../../expect-red";
import { surfaceGuard, type EachCallRule } from "../../surface-guard";

const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url));

const NAMES_ITS_STORE: EachCallRule = {
  call: /\brateLimit\s*\(/,
  mustInclude: /\bstore:\s*["']global["']/,
  requirement: 'pass { store: "global" }',
  unless: /\bwithTenant\(/,
};

expectRed(["api/admin/invites/route.ts:4", "api/admin/reports/route.ts:5"], () =>
  surfaceGuard({
    name: "rate limits on admin routes name their store (bad fixture)",
    root: fixture("bad"),
    files: /^api\/admin\/.+\/route\.ts$/,
    eachCall: NAMES_ITS_STORE,
    minFiles: 4,
  }),
);

surfaceGuard({
  name: "rate limits on admin routes name their store (good fixture)",
  root: fixture("good"),
  files: /^api\/admin\/.+\/route\.ts$/,
  eachCall: NAMES_ITS_STORE,
  minFiles: 4,
});
