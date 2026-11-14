import { safeFileNamePart } from "../files";

/** Extension of a backup file: a plain SQLite database, like `belegwerk.db`. */
export const BACKUP_FILE_EXTENSION = "db";

/** The time of the backup in the name is German time, whatever the machine's zone. */
const BACKUP_TIME_ZONE = "Europe/Berlin";

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BACKUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Suggested name of a backup file (#32): `<base>-YYYY-MM-DD_HHMM.db` with
 * the time of the backup in Europe/Berlin, e.g.
 * `belegwerk-backup-2026-11-14_1530.db`. Sorts by time; characters Windows
 * forbids in `base` become `_`.
 */
export function backupFileName(base: string, now: Date): string {
  const parts: Record<string, string> = {};
  for (const part of berlinParts.formatToParts(now)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const { year, month, day, hour, minute } = parts;
  return `${safeFileNamePart(base)}-${year}-${month}-${day}_${hour}${minute}.${BACKUP_FILE_EXTENSION}`;
}
