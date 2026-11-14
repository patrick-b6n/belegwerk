import { fileNameOfPath, type SavePathPicker } from "../files";
import type { Clock } from "../repositories";
import { BACKUP_FILE_EXTENSION, backupFileName } from "./backup-file-name";

/**
 * Port for writing the backup (#32). `src/app` implements it on top of the
 * persistence layer (`VACUUM INTO`, docs/architecture.md, "Datensicherung").
 */
export interface DatabaseBackup {
  /**
   * Writes a consistent, checked copy of the whole database to `path`,
   * replacing a file there.
   *
   * @throws if writing or the check fails.
   */
  writeTo(path: string): Promise<void>;
}

/** UI texts for {@link BackupService.createBackup}. */
export interface CreateBackupRequest {
  /** First part of the suggested file name, e.g. `"belegwerk-backup"`. */
  readonly fileNameBase: string;
  /** Name of the dialog's file type filter, e.g. "SQLite-Datenbank". */
  readonly filterName: string;
}

export type CreateBackupResult =
  /** Backup written to `path`; `fileName` is its name without directory. */
  | { readonly saved: true; readonly fileName: string; readonly path: string }
  /** The user cancelled the save dialog; nothing was written. */
  | { readonly saved: false };

export interface BackupService {
  /**
   * "Backup erstellen" (#32): asks for the target via the save dialog
   * (suggested name with the current date and time) and writes a copy of
   * the database there.
   *
   * @throws if writing or checking the backup fails.
   */
  createBackup(request: CreateBackupRequest): Promise<CreateBackupResult>;
}

export interface BackupServiceDependencies {
  readonly savePathPicker: SavePathPicker;
  readonly databaseBackup: DatabaseBackup;
  readonly clock: Clock;
}

export function createBackupService({
  savePathPicker,
  databaseBackup,
  clock,
}: BackupServiceDependencies): BackupService {
  return {
    createBackup: async ({ fileNameBase, filterName }) => {
      const path = await savePathPicker.pickSavePath({
        defaultFileName: backupFileName(fileNameBase, clock()),
        filter: { name: filterName, extensions: [BACKUP_FILE_EXTENSION] },
      });
      if (path === null) return { saved: false };
      await databaseBackup.writeTo(path);
      return { saved: true, fileName: fileNameOfPath(path), path };
    },
  };
}
