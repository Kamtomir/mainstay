import { configDefaults, defineConfig } from "vitest/config";

/**
 * The default run: guards, evals, script tests and the examples.
 * It needs no database and no network. The real-Postgres templates in
 * ci/integration run with `npm run test:integration` (see that config).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, "ci/integration/**", "**/fixture/**"],
    // Shell-script tests spawn bash and git; give slow laptops some room.
    testTimeout: 20_000,
  },
});
