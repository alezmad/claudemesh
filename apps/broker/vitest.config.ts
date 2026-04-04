import baseConfig from "@turbostarter/vitest-config/base";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * Broker test suite.
 *
 * Integration tests run against a real Postgres database (default:
 * claudemesh_test on the dev Postgres container). Set DATABASE_URL
 * in the environment to point elsewhere.
 *
 * Tests rely on mesh isolation: each test creates its own mesh via
 * the setupTestMesh helper, so tests can run in parallel without
 * colliding. No per-test TRUNCATE needed.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 10_000,
      hookTimeout: 10_000,
      // Keep sequential initially — can flip to parallel once
      // per-test isolation is proven.
      sequence: {
        concurrent: false,
      },
    },
  }),
);
