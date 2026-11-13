import { defineConfig } from "drizzle-kit";

// Only used by `pnpm db:generate` (drizzle-kit generate). The app applies the
// generated migrations itself at startup (#10); see docs/data-model.md.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/persistence/schema.ts",
  out: "./src/persistence/migrations",
  strict: true,
  verbose: true,
});
