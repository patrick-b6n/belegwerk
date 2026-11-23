import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  type DownloadProgress,
  UPDATE_ERROR_KINDS,
  type UpdateCheck,
  UpdateError,
  type UpdateErrorKind,
  type Updater,
} from "@/business/updates";

/**
 * Release pages the app opens; the same prefix as the opener capability in
 * `src-tauri/capabilities/default.json` (and the check in the host).
 */
export const RELEASE_PAGE_PREFIX = "https://github.com/patrick-b6n/belegwerk-next/releases/";

/**
 * {@link Updater} of the app (#71): the host commands `check_for_update` and
 * `install_update` (src-tauri/src/updater.rs; permissions
 * `allow-check-for-update`/`allow-install-update`) and `openUrl` of
 * `tauri-plugin-opener` for the release notes (capability: this
 * repository's release pages only).
 *
 * Results are validated; errors of the host (`{ kind, message }`) become an
 * {@link UpdateError} with that kind, anything else `unexpected`.
 */
export function createTauriUpdater(): Updater {
  return {
    check: async () => {
      let result: unknown;
      try {
        result = await invoke("check_for_update");
      } catch (error) {
        throw toUpdateError(error);
      }
      return parseUpdateCheck(result);
    },
    install: async (onProgress) => {
      const channel = new Channel<DownloadProgress>(onProgress);
      try {
        await invoke("install_update", { onProgress: channel });
      } catch (error) {
        throw toUpdateError(error);
      }
    },
    openReleasePage: async (url) => {
      if (!url.startsWith(RELEASE_PAGE_PREFIX)) {
        throw new Error(`Not a release page of Belegwerk: ${url}`);
      }
      await openUrl(url);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The host's serialized `UpdateError`, or `unexpected` for anything else. */
export function toUpdateError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;
  if (
    isRecord(error) &&
    typeof error.kind === "string" &&
    (UPDATE_ERROR_KINDS as readonly string[]).includes(error.kind)
  ) {
    const message = typeof error.message === "string" ? error.message : "";
    const path = typeof error.path === "string" ? error.path : null;
    return new UpdateError(error.kind as UpdateErrorKind, message, { path });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new UpdateError("unexpected", message, { cause: error });
}

export function parseUpdateCheck(value: unknown): UpdateCheck {
  if (
    isRecord(value) &&
    typeof value.currentVersion === "string" &&
    typeof value.latestVersion === "string" &&
    typeof value.updateAvailable === "boolean" &&
    typeof value.releaseUrl === "string" &&
    value.releaseUrl.startsWith(RELEASE_PAGE_PREFIX)
  ) {
    return {
      currentVersion: value.currentVersion,
      latestVersion: value.latestVersion,
      updateAvailable: value.updateAvailable,
      releaseUrl: value.releaseUrl,
    };
  }
  throw new UpdateError("unexpected", "Unexpected result of check_for_update");
}
