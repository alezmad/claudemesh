import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Builds the CLI on demand when `dist/entrypoints/cli.js` is
    // missing or older than its sources. Required by the golden
    // tests in `tests/golden/` which spawn the built artifact.
    globalSetup: ["tests/setup/ensure-built.ts"],
    alias: {
      "~": resolve(__dirname, "src"),
    },
  },
});
