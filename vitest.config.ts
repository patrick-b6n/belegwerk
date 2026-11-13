import { defineConfig } from "vitest/config";

// Run tests in a non-UTC time zone (UTC-11, no DST) so code that
// accidentally formats in local time fails instead of passing on UTC CI
// runners. Set before workers start, so they inherit it.
process.env.TZ = "Pacific/Pago_Pago";

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
