/**
 * Guard: every API route checks the session.
 *
 * In your repository this is the whole file, minus expectRed(): point `root`
 * at the app, keep the rule, and the export route below turns CI red.
 */
import { fileURLToPath } from "node:url";
import { expectRed } from "../../guards/expect-red";
import { surfaceGuard } from "../../guards/surface-guard";

const app = fileURLToPath(new URL(".", import.meta.url));

expectRed(["app/api/orders/export/route.ts"], () =>
  surfaceGuard({
    name: "every API route checks the session",
    root: app,
    files: /^app\/api\/.+\/route\.ts$/,
    require: /\brequireUser\(/,
    requirement: "call requireUser(request)",
    minFiles: 2,
    hint: "call requireUser(request) first and return its response when it fails, or add the route to `allow` with the reason it is public.",
  }),
);
