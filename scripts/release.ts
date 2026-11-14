// Builds the single Belegwerk .exe (#33): `pnpm release`.
//
// `tauri build --no-bundle` (release profile, frontend embedded, no installer),
// then copies src-tauri/target/release/belegwerk.exe to
// release/belegwerk-<version>.exe and writes its SHA-256 next to it.
// Checks (format, lint, typecheck, tests) are separate: `pnpm verify`.
// See docs/release.md.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");

// `shell` so that `pnpm`/`git` resolve to their .cmd shims on Windows. Fixed
// command lines only (no user input), passed as one string.
function run(command: string): string {
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (exit code ${result.status})`);
  }
  return result.stdout;
}

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
};

// Only a hint: a release from uncommitted changes cannot be reproduced.
try {
  if (run("git status --porcelain").trim() !== "") {
    console.warn("Warnung: Das Arbeitsverzeichnis enthält nicht committete Änderungen.");
  }
} catch {
  console.warn("Warnung: git status nicht verfügbar.");
}

const build = spawnSync("pnpm tauri build --no-bundle", {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
if (build.status !== 0) {
  console.error(`tauri build fehlgeschlagen (Exit-Code ${build.status}).`);
  process.exit(build.status ?? 1);
}

const source = join(root, "src-tauri", "target", "release", "belegwerk.exe");
const targetDir = join(root, "release");
const target = join(targetDir, `belegwerk-${version}.exe`);
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
// Format of `sha256sum`; check with `Get-FileHash` or `sha256sum -c`.
writeFileSync(`${target}.sha256`, `${sha256}  ${basename(target)}\n`);

const megabytes = (statSync(target).size / 1024 / 1024).toFixed(1);
console.log("");
console.log(`Release:  ${relative(root, target)} (${megabytes} MB)`);
console.log(`SHA-256:  ${sha256}`);
