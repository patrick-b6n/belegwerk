/**
 * Version scheme (#71, #74): Belegwerk versions are the date and time of the
 * release in UTC (published releases and local builds alike), shown as
 * `YYYY-MM-DD-HHMM` (e.g. `2026-11-14-2000`) – in the tag
 * (`v2026-11-14-2000`), the asset names and the UI.
 *
 * Tauri and the Windows file version need SemVer with numeric parts of at
 * most 65535, so package.json carries `YYYY.(MM*100+DD).(HH*100+MM)`:
 * `2026-11-14-2000` → `2026.1114.2000`, `2026-01-05-0930` → `2026.105.930`.
 * The order of both forms is the same. The committed package.json has the
 * development placeholder `0.0.0`; the release scripts set the real version
 * for the build only.
 *
 * No imports: `scripts/` (Node) uses this file directly. The Rust updater has
 * the same conversion (src-tauri/src/updater.rs).
 */

export interface CalVerParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export const DEV_VERSION = "0.0.0";

const CALVER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function isValid({ year, month, day, hour, minute }: CalVerParts): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59) {
    return false;
  }
  // Day 0 of the next month is the last day of this month.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatCalVer({ year, month, day, hour, minute }: CalVerParts): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}-${pad(hour)}${pad(minute)}`;
}

/**
 * The version of a point in time, in UTC – independent of the machine's time
 * zone, without DST jumps (#74).
 */
export function calVerFromDate(date: Date): string {
  return formatCalVer({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  });
}

export function parseCalVer(text: string): CalVerParts | null {
  const match = CALVER_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const parts = { year, month, day, hour, minute };
  return isValid(parts) ? parts : null;
}

/** `2026-11-14-2000` → `2026.1114.2000`; `null` if `calVer` is invalid. */
export function calVerToSemVer(calVer: string): string | null {
  const parts = parseCalVer(calVer);
  if (!parts) return null;
  return `${parts.year}.${parts.month * 100 + parts.day}.${parts.hour * 100 + parts.minute}`;
}

/** `2026.1114.2000` → `2026-11-14-2000`; `null` if it encodes no valid date and time. */
export function semVerToCalVer(semVer: string): string | null {
  const match = SEMVER_PATTERN.exec(semVer);
  if (!match) return null;
  const [year, monthDay, hourMinute] = match.slice(1).map(Number) as [number, number, number];
  const parts = {
    year,
    month: Math.floor(monthDay / 100),
    day: monthDay % 100,
    hour: Math.floor(hourMinute / 100),
    minute: hourMinute % 100,
  };
  return isValid(parts) ? formatCalVer(parts) : null;
}

/** The CalVer of a release tag `v<YYYY-MM-DD-HHMM>`; `null` for any other tag. */
export function calVerFromTag(tag: string): string | null {
  if (!tag.startsWith("v")) return null;
  const calVer = tag.slice(1);
  return parseCalVer(calVer) ? calVer : null;
}

function semVerParts(calVer: string): number[] {
  const semVer = calVerToSemVer(calVer);
  if (semVer === null) throw new Error(`Invalid CalVer ${JSON.stringify(calVer)}`);
  return semVer.split(".").map(Number);
}

/**
 * Compares two valid CalVers in SemVer form (as the updater does): negative
 * if `a` is older, positive if newer, 0 if equal.
 *
 * @throws if one of them is no valid CalVer.
 */
export function compareCalVer(a: string, b: string): number {
  const [x, y] = [semVerParts(a), semVerParts(b)];
  for (let i = 0; i < 3; i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The highest CalVer among release tags (`v<YYYY-MM-DD-HHMM>`); other tags
 * are ignored. `null` if there is none.
 */
export function latestCalVerOfTags(tags: Iterable<string>): string | null {
  let latest: string | null = null;
  for (const tag of tags) {
    const calVer = calVerFromTag(tag);
    if (calVer !== null && (latest === null || compareCalVer(calVer, latest) > 0)) {
      latest = calVer;
    }
  }
  return latest;
}

/**
 * The CalVer one minute after `calVer` (rolls over hour, day, month and
 * year; leap years included). Pure calendar arithmetic in UTC.
 *
 * @throws if `calVer` is invalid or the result has no four-digit year.
 */
export function nextMinuteCalVer(calVer: string): string {
  const parts = parseCalVer(calVer);
  if (!parts) throw new Error(`Invalid CalVer ${JSON.stringify(calVer)}`);
  const { year, month, day, hour, minute } = parts;
  // Date.UTC normalises overflowing minutes.
  const result = calVerFromDate(new Date(Date.UTC(year, month - 1, day, hour, minute + 1)));
  if (!parseCalVer(result)) throw new Error(`No CalVer after ${calVer}`);
  return result;
}

/**
 * The version of a new release (#74): `now`, unless it is not strictly newer
 * than the latest release `latest` (two releases in the same minute, a clock
 * running behind) – then one minute after
 * `latest`. Always strictly newer than `latest`.
 */
export function nextReleaseCalVer(now: string, latest: string | null): string {
  if (latest === null || compareCalVer(now, latest) > 0) return now;
  return nextMinuteCalVer(latest);
}

/** How a package version is shown: CalVer, or unchanged (e.g. `0.0.0`). */
export function displayVersion(semVer: string): string {
  return semVerToCalVer(semVer) ?? semVer;
}
