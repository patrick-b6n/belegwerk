import { defineConfig } from "vitest/config";

// Minimal setup for #4's unit tests. Kept separate from vite.config.ts so
// tests don't load the TanStack Start / Paraglide plugins. Full test setup
// (environments, conventions, coverage) follows in #6.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
