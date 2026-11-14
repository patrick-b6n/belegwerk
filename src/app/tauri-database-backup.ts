import { writeTextFile } from "@tauri-apps/plugin-fs";

import type { DatabaseBackup } from "@/business/backup";
import type { Database } from "@/persistence/database";

/**
 * {@link DatabaseBackup} of the app (#32): SQLite writes the copy itself
 * (`VACUUM INTO`, {@link Database.backupTo}) – in the Rust process, so the
 * fs plugin's scope does not apply to that write.
 *
 * `VACUUM INTO` refuses a target that exists and is not empty, but the save
 * dialog lets the user pick an existing file (after asking to replace it).
 * So the picked file is first created or truncated to zero bytes with
 * `writeTextFile(path, "")` – the permission the CSV export already has
 * (`fs:allow-write-text-file`), and the dialog put exactly this path into the
 * fs scope. No `fs:allow-remove`/`rename`/`copy-file` and no temporary file
 * that would need a static scope (docs/architecture.md, "Datensicherung").
 *
 * If writing or checking fails, the file is truncated again (best effort):
 * an empty file is plainly no backup, a half-written one might pass for one.
 */
export function createTauriDatabaseBackup(database: Pick<Database, "backupTo">): DatabaseBackup {
  return {
    writeTo: async (path) => {
      await writeTextFile(path, "");
      try {
        await database.backupTo(path);
      } catch (error) {
        await writeTextFile(path, "").catch(() => undefined);
        throw error;
      }
    },
  };
}
