import { defineConfig } from "@inlang/paraglide-js";

// Shared by the Vite plugin (dev/build) and the CLI (`pnpm i18n:compile`,
// used before typecheck), so both emit identical output.
export default defineConfig({
  outdir: "./src/paraglide",
  // Physical files (not Vite's virtual modules) so `tsc` sees the same
  // modules and declarations as the bundler.
  outputStructure: "message-modules",
  emitTsDeclarations: true,
  // Only one locale (`de`); no URL/cookie detection needed.
  strategy: ["baseLocale"],
});
