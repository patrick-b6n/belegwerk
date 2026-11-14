// Version of the next published release (#74), used by
// .github/workflows/release.yml: `node scripts/release-version.ts < tags`.
//
// Reads the existing tag names (one per line, e.g. `v2026-11-14-2000`) from
// stdin and prints the CalVer `YYYY-MM-DD-HHMM` of the current time in UTC –
// or, if that is not strictly newer than the highest release tag (two pushes
// in the same minute, a clock behind), one minute after that tag. See
// docs/release.md.

import { readFileSync } from "node:fs";

import {
  calVerFromDate,
  latestCalVerOfTags,
  nextReleaseCalVer,
} from "../src/business/updates/calver.ts";

const tags = readFileSync(0, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim());
const latest = latestCalVerOfTags(tags);
const now = calVerFromDate(new Date());
const version = nextReleaseCalVer(now, latest);

console.error(
  `Jetzt (UTC): ${now}, letztes Release: ${latest ?? "(keins)"}, neue Version: ${version}`,
);
console.log(version);
