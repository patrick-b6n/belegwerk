// Publishes a release (#71): `pnpm release:tag`.
//
// Creates the tag `v<YYYY-MM-DD-HHMM>` (current local time, CalVer,
// src/business/updates/calver.ts) on the current commit of `main` and pushes
// it; the push starts .github/workflows/release.yml, which builds the exe
// and creates the GitHub release. Refuses unless the working tree is clean,
// `main` is checked out and it equals `origin/main`, and unless the new
// version is higher than every existing release tag (local and on origin;
// the clock may be wrong or another machine may have tagged). See
// docs/release.md.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  calVerFromDate,
  compareCalVer,
  latestCalVerOfTags,
} from "../src/business/updates/calver.ts";

const root = join(import.meta.dirname, "..");

// Fixed command lines only; the tag name is generated (digits and dashes).
function git(args: string): { status: number | null; stdout: string } {
  const result = spawnSync(`git ${args}`, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

function gitOrFail(args: string): string {
  const result = git(args);
  if (result.status !== 0) fail(`git ${args} fehlgeschlagen (Exit-Code ${result.status}).`);
  return result.stdout;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (gitOrFail("status --porcelain") !== "") {
  fail("Das Arbeitsverzeichnis enthält nicht committete Änderungen – erst committen.");
}
const branch = gitOrFail("rev-parse --abbrev-ref HEAD");
if (branch !== "main") fail(`Releases nur von main (aktuell: ${branch}).`);
gitOrFail("fetch --quiet origin main");
const head = gitOrFail("rev-parse HEAD");
const remote = gitOrFail("rev-parse origin/main");
if (head !== remote) {
  fail("main entspricht nicht origin/main – erst pullen bzw. pushen.");
}

// The version is the time the tag is created.
const calVer = calVerFromDate(new Date());
const tag = `v${calVer}`;

// Every existing release tag, local (after fetching origin's) and on origin.
gitOrFail("fetch --quiet --tags origin");
const localTags = gitOrFail('tag --list "v*"').split("\n");
const remoteTags = gitOrFail('ls-remote --tags --refs origin "refs/tags/v*"')
  .split("\n")
  .map((line) => line.split("refs/tags/")[1] ?? "");
const latest = latestCalVerOfTags([...localTags, ...remoteTags]);
if (latest !== null && compareCalVer(calVer, latest) <= 0) {
  fail(
    `Die neue Version ${calVer} ist nicht neuer als das letzte Release ${latest} – ` +
      "Systemuhr prüfen bzw. eine Minute warten.",
  );
}
if (git(`rev-parse --quiet --verify refs/tags/${tag}`).status === 0) {
  fail(`Tag ${tag} gibt es schon – in einer Minute erneut versuchen.`);
}
if (gitOrFail(`ls-remote --tags origin refs/tags/${tag}`) !== "") {
  fail(`Tag ${tag} gibt es auf origin schon.`);
}

gitOrFail(`tag ${tag}`);
if (git(`push origin refs/tags/${tag}`).status !== 0) {
  git(`tag -d ${tag}`);
  fail(`Push von ${tag} fehlgeschlagen; der lokale Tag wurde wieder gelöscht.`);
}
console.log(`Tag ${tag} auf ${head.slice(0, 7)} gepusht – der Workflow „Release“ baut jetzt.`);
