import { defineConfig } from "vitest/config";

/**
 * Real-Postgres integration templates (ci/integration). Separate config, so
 * `npm test` stays database-free. Run against a database that already has the
 * migrations applied:
 *
 *   ci/migrations/apply-migrations.sh "$TEST_DATABASE_URL"
 *   TEST_DATABASE_URL=... npm run test:integration
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["ci/integration/**/*.int.test.ts"],
    // The files share one database: run them one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
