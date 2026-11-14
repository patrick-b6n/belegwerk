import { cn } from "cn";
import { Download, ExternalLink, Loader2 } from "lucide-react";

import { downloadPercent, type UpdateCheck } from "@/business/updates";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

import { installErrorMessage, installProgressMessage } from "./update-messages";
import { useInstallUpdate, useOpenReleaseNotes } from "./update-queries";

/**
 * "Release-Notes" and "Jetzt aktualisieren" for a newer version (#71), used
 * by the notice in the top bar and by the settings section.
 *
 * - The release notes open in the default browser.
 * - While the update runs the button is disabled (still focusable) with a
 *   spinner and the download progress; a progress bar shows it as well. On
 *   success the app restarts.
 * - Errors appear below (`role="alert"`) with the note that the installed
 *   version is unchanged.
 */
export function UpdateActions({
  check,
  compact = false,
}: Readonly<{ check: UpdateCheck; compact?: boolean }>) {
  const { mutation: install, progress, blocked } = useInstallUpdate();
  const openReleaseNotes = useOpenReleaseNotes();
  const running = install.isPending;
  const percent = progress === null ? null : downloadPercent(progress);

  return (
    <div className={cn("flex flex-col items-start", compact ? "gap-2" : "gap-3")}>
      <div className={cn("flex flex-wrap items-center", compact ? "gap-1" : "gap-2")}>
        <Button
          size={compact ? "sm" : "default"}
          disabled={running || blocked}
          focusableWhenDisabled
          aria-busy={running || undefined}
          className="data-disabled:cursor-not-allowed data-disabled:opacity-50"
          onClick={() => install.mutate()}
        >
          {running ? <Loader2 aria-hidden className="animate-spin" /> : <Download aria-hidden />}
          {running ? installProgressMessage(progress) : m.update_install()}
        </Button>
        <Button
          variant="link"
          size={compact ? "sm" : "default"}
          onClick={() => openReleaseNotes.mutate(check)}
        >
          {m.update_release_notes()}
          <ExternalLink aria-hidden />
        </Button>
      </div>
      {running && percent !== null && (
        <div
          role="progressbar"
          aria-label={m.update_progress_label()}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      {install.error && (
        <p role="alert" className="max-w-3xl text-sm break-words text-destructive">
          {installErrorMessage(install.error)}
        </p>
      )}
      {openReleaseNotes.error && (
        <p role="alert" className="max-w-3xl text-sm text-destructive">
          {m.update_release_notes_error()}
        </p>
      )}
    </div>
  );
}
