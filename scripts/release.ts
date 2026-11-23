// Builds the single Belegwerk .exe (#33, #71, #74): `pnpm release`.
//
// The version is the build time (CalVer `YYYY-MM-DD-HHMM`, UTC,
// src/business/updates/calver.ts) or `--calver <YYYY-MM-DD-HHMM>` (the
// release workflow passes the version of scripts/release-version.ts). package.json gets the SemVer form
// (`YYYY.MMDD.HHMM`) for the build only and is restored afterwards.
//
// `tauri build --no-bundle` (release profile, frontend embedded, no
// installer), then copies src-tauri/target/release/belegwerk.exe to
// release/belegwerk.exe and writes its SHA-256 next to it.
// Checks (format, lint, typecheck, tests) are separate: `pnpm verify`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";

import { calVerFromDate, calVerToSemVer } from "../src/business/updates/calver.ts";

const root = join(import.meta.dirname, "..");
const packageJsonPath = join(root, "package.json");

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

class ReleaseError extends Error {}

/** package.json with `version` replaced; the rest of the text stays as it is. */
function withVersion(packageJson: string, version: string): string {
  const pattern = /("version"\s*:\s*)"[^"]*"/;
  if (!pattern.test(packageJson)) throw new ReleaseError("package.json has no version field.");
  return packageJson.replace(pattern, `$1"${version}"`);
}

function release(calVer: string, semVer: string): void {
  console.log(`Version ${calVer} (package.json for the build: ${semVer})`);
  const build = spawnSync("pnpm tauri build --no-bundle", {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new ReleaseError(`tauri build failed (exit code ${build.status}).`);
  }

  const source = join(root, "src-tauri", "target", "release", "belegwerk.exe");
  const targetDir = join(root, "release");
  const target = join(targetDir, "belegwerk.exe");
  mkdirSync(targetDir, { recursive: true });
  try {
    copyFileSync(source, target);
  } catch (error) {
    throw new ReleaseError(
      `Copying to ${relative(root, target)} failed – is the .exe still running? (${String(error)})`,
    );
  }

  // The version in the exe comes from package.json via tauri.conf.json; make
  // sure the build really picked it up (src-tauri/build.rs). Windows may
  // report the file version with a fourth part (`2026.1114.2000.0`).
  let fileVersion: string;
  try {
    fileVersion = run(
      `powershell -NoProfile -NonInteractive -Command "(Get-Item -LiteralPath '${target}').VersionInfo.FileVersion"`,
    ).trim();
  } catch (error) {
    throw new ReleaseError(`Could not read the version of the .exe. (${String(error)})`);
  }
  if (fileVersion !== semVer && fileVersion !== `${semVer}.0`) {
    throw new ReleaseError(
      `Version mismatch: expected ${semVer}, the .exe reports ${fileVersion || "(none)"}. ` +
        "Please build again (delete src-tauri/target/release if needed).",
    );
  }

  const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
  // Format of `sha256sum`; check with `Get-FileHash` or `sha256sum -c`.
  writeFileSync(`${target}.sha256`, `${sha256}  ${basename(target)}\n`);

  const megabytes = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log("");
  console.log(`Release:  ${relative(root, target)} (${megabytes} MB)`);
  console.log(`Version:  ${calVer} (${semVer})`);
  console.log(`SHA-256:  ${sha256}`);
}

const { values } = parseArgs({ options: { calver: { type: "string" } } });
const calVer = values.calver ?? calVerFromDate(new Date());
const semVer = calVerToSemVer(calVer);
if (semVer === null) {
  console.error(`Invalid version ${JSON.stringify(calVer)} – expected YYYY-MM-DD-HHMM.`);
  process.exit(1);
}

// Only a hint: a release from uncommitted changes cannot be traced back to
// a commit. (Builds are not bit-for-bit reproducible either way; the
// SHA-256 identifies this file, not the source.)
try {
  if (run("git status --porcelain").trim() !== "") {
    console.warn("Warning: the working tree has uncommitted changes.");
  }
} catch {
  console.warn("Warning: git status not available.");
}

// Ctrl+C reaches the build as well; staying alive until it has ended lets
// `finally` restore package.json.
process.on("SIGINT", () => {});

const original = readFileSync(packageJsonPath, "utf8");
try {
  writeFileSync(packageJsonPath, withVersion(original, semVer));
  release(calVer, semVer);
} catch (error) {
  console.error(error instanceof ReleaseError ? error.message : error);
  process.exitCode = 1;
} finally {
  writeFileSync(packageJsonPath, original);
}
