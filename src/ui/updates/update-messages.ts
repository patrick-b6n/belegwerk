/**
 * UI texts of the auto-update (#71): the error kinds of the updater and the
 * result of a check (business returns codes, the UI translates
 * them).
 */
import {
  type DownloadProgress,
  downloadPercent,
  type UpdateCheck,
  UpdateError,
  type UpdateErrorKind,
} from "@/business/updates";
import { m } from "@/paraglide/messages.js";

/**
 * Message of an update error kind. `path` is the parked old exe of
 * `rollbackFailed`.
 */
export function updateErrorKindMessage(kind: UpdateErrorKind, path?: string | null): string {
  switch (kind) {
    case "network":
      return m.update_error_network();
    case "http":
      return m.update_error_http();
    case "noRelease":
      return m.update_error_no_release();
    case "invalidRelease":
      return m.update_error_invalid_release();
    case "checksumMismatch":
      return m.update_error_checksum();
    case "noUpdate":
      return m.update_error_no_update();
    case "devBuild":
      return m.update_error_dev_build();
    case "fileSystem":
      return m.update_error_file_system();
    case "rollbackFailed":
      return path
        ? m.update_error_rollback_failed({ path })
        : m.update_error_rollback_failed_no_path();
    case "alreadyRunning":
      return m.update_error_already_running();
    case "unexpected":
      return m.update_error_unexpected();
  }
  // Unreachable with the typed kinds; a new kind without a text is a programmer error.
  throw new Error(`No message for update error ${String(kind)}`);
}

/** Message of any error of a check or an install. */
export function updateErrorMessage(error: unknown): string {
  return error instanceof UpdateError
    ? updateErrorKindMessage(error.kind, error.path)
    : updateErrorKindMessage("unexpected");
}

/**
 * Message of a failed install: the error plus the note that the installed
 * version is unchanged – not after a failed rollback (the exe is missing)
 * and not when another install is still running.
 */
export function installErrorMessage(error: unknown): string {
  const message = updateErrorMessage(error);
  const kind = error instanceof UpdateError ? error.kind : "unexpected";
  return kind === "rollbackFailed" || kind === "alreadyRunning"
    ? message
    : `${message} ${m.update_error_unchanged()}`;
}

/** Result of "Check for updates". */
export function updateCheckMessage(check: UpdateCheck): string {
  return check.updateAvailable
    ? m.update_available({ version: check.latestVersion, currentVersion: check.currentVersion })
    : m.update_up_to_date({ version: check.currentVersion });
}

/**
 * Label of the running install: download progress in percent while known,
 * then (download complete) that the update is being installed.
 */
export function installProgressMessage(progress: DownloadProgress | null): string {
  const percent = progress === null ? null : downloadPercent(progress);
  if (percent === null) return m.update_installing();
  if (percent >= 100) return m.update_installing_done();
  return m.update_installing_percent({ percent });
}
