import { DatabaseBackup as BackupIcon, Loader2 } from "lucide-react";

import { BackupWriteError } from "@/business/backup";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { toast } from "@/ui/components/ui/toast";

import { useCreateBackup } from "./backup-mutations";

/**
 * Where the Tauri host keeps the database (src-tauri/src/lib.rs,
 * docs/data-model.md) – shown for the manual restore.
 */
const DATABASE_LOCATION = "%APPDATA%\\de.belegwerk.desktop\\belegwerk.db";

/**
 * Section "Backup" on `/settings` (#32): explains what a backup
 * contains and how to restore it, and "Backup erstellen" saves a copy of the
 * database via the save dialog.
 *
 * - While the backup runs the button is disabled (still focusable) with a
 *   spinner.
 * - Success: toast with the file name. Cancelling the dialog shows nothing.
 *   A target in the app's data folder is refused (own error toast, nothing
 *   written); other errors show an error toast – saying whether the target
 *   file was emptied – with details in the console.
 */
export function BackupSection() {
  const createBackup = useCreateBackup();
  const running = createBackup.isPending;

  const run = async () => {
    try {
      const result = await createBackup.mutateAsync({
        fileNameBase: m.backup_file_base(),
        filterName: m.backup_file_type(),
      });
      if (!result.saved) {
        if (result.reason === "targetInDatabaseFolder") {
          toast.add({ title: m.backup_error_database_folder(), type: "error" });
        }
        return;
      }
      toast.add({
        title: m.backup_saved_toast(),
        description: m.backup_saved({ fileName: result.fileName }),
        type: "success",
      });
    } catch (error) {
      console.error("Backup failed", error);
      toast.add({
        title: m.backup_error(),
        description:
          error instanceof BackupWriteError && error.targetCleared
            ? m.backup_error_target_cleared()
            : undefined,
        type: "error",
      });
    }
  };

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {m.backup_location({ path: DATABASE_LOCATION })}
      </p>
      <Button
        variant="outline"
        title={m.backup_hint()}
        disabled={running}
        focusableWhenDisabled
        aria-busy={running || undefined}
        className="data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-background"
        onClick={() => void run()}
      >
        {running ? <Loader2 aria-hidden className="animate-spin" /> : <BackupIcon aria-hidden />}
        {running ? m.backup_running() : m.backup_create()}
      </Button>
    </div>
  );
}
