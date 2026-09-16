import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    // Database suites share an isolated database; the bootstrap suite requires
    // an empty owner fixture. Each suite removes only its own synthetic rows.
    fileParallelism: false,
  },
});
