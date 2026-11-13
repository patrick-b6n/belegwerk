import { defineConfig } from "@inlang/paraglide-js";

// Single source of truth for the compiler options, read by both the Vite
// plugin (dev/build) and the CLI (`pnpm i18n:compile`, run before typecheck).
// The generated modules and their types are the same; the runtime flags may
// differ (e.g. the Vite plugin sets `isServer`/`isDevelopment` per build).
export default defineConfig({
  outdir: "./src/paraglide",
  // Physical files (not Vite's virtual modules) so `tsc` sees the same
  // modules and declarations as the bundler.
  outputStructure: "message-modules",
  emitTsDeclarations: true,
  // Only one locale (`de`); no URL/cookie detection needed.
  strategy: ["baseLocale"],
});
