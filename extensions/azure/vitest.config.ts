import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    globals: true,
  },
});
