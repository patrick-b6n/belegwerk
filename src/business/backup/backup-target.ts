/**
 * Guard against saving a backup into the app's data folder (#32): emptying
 * the picked file before `VACUUM INTO` would destroy the live database
 * (`belegwerk.db`) or its journal if the user picked one of them.
 */

/** The picked target lies in (or below) the folder of the live database. */
export class BackupTargetInDatabaseFolderError extends Error {
  constructor() {
    super("The backup target is inside the folder of the app's database");
    this.name = "BackupTargetInDatabaseFolderError";
  }
}

/**
 * Writing the backup failed. `targetCleared`: the picked file had already
 * been emptied (a file that existed there is gone).
 */
export class BackupWriteError extends Error {
  readonly targetCleared: boolean;

  constructor(targetCleared: boolean, options?: ErrorOptions) {
    super("Writing the backup failed", options);
    this.name = "BackupWriteError";
    this.targetCleared = targetCleared;
  }
}

/** `\\?\`, `\\.\` and `\??\` – device/NT prefixes in front of a drive path. */
const DEVICE_PREFIX = /^(?:\\\\[?.]\\|\\\?\?\\)/;
/** The same prefixes in front of `UNC\server\share`. */
const DEVICE_UNC_PREFIX = /^(?:\\\\[?.]\\|\\\?\?\\)unc\\/i;

/**
 * Normalizes a Windows path for comparison: `/` → `\`; without the
 * `\\?\`, `\\.\` and `\??\` prefixes (also before `UNC\`); without duplicate
 * separators, `.`/`..` segments and trailing separators; trailing dots and
 * spaces of each segment removed (Win32 ignores them:
 * `de.belegwerk.desktop.\belegwerk.db` is the real file); lower case
 * (Windows file names are case-insensitive).
 */
export function normalizeWindowsPath(path: string): string {
  let rest = path.trim().replaceAll("/", "\\");
  let prefix = "";
  const unc = DEVICE_UNC_PREFIX.exec(rest);
  const device = DEVICE_PREFIX.exec(rest);
  if (unc) {
    prefix = "\\\\";
    rest = rest.slice(unc[0].length);
  } else if (device) {
    rest = rest.slice(device[0].length);
  } else if (rest.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = rest.slice(2);
  }
  const segments: string[] = [];
  for (const raw of rest.split("\\")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      if (segments.length > 1) segments.pop();
      continue;
    }
    const segment = raw.replace(/[. ]+$/, "");
    if (segment === "") continue;
    segments.push(segment);
  }
  return (prefix + segments.join("\\")).toLowerCase();
}

/**
 * Whether `target` lies in the folder of `databaseFile` or below it – the
 * database itself, its `-journal`/`-wal`/`-shm` files, any other file there.
 * Compared after {@link normalizeWindowsPath}; symbolic links, junctions,
 * hard links, other drive mappings, UNC paths to the local machine
 * (`\\localhost\C$\…`) and 8.3 short names of the folder are not resolved.
 */
export function isInDatabaseFolder(target: string, databaseFile: string): boolean {
  const file = normalizeWindowsPath(databaseFile);
  const separator = file.lastIndexOf("\\");
  if (separator <= 0) {
    throw new Error(`Cannot determine the folder of the database file "${databaseFile}"`);
  }
  const folder = file.slice(0, separator);
  const normalized = normalizeWindowsPath(target);
  return normalized === folder || normalized.startsWith(`${folder}\\`);
}
