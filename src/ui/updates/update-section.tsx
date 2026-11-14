import { Loader2, RefreshCw } from "lucide-react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

import { UpdateActions } from "./update-actions";
import { updateCheckMessage, updateErrorMessage } from "./update-messages";
import { useCheckForUpdate } from "./update-queries";

/**
 * Section "Updates" on `/settings` (#71): "Check for updates" asks
 * GitHub for the latest release and shows the result – up to date, newer
 * version (with release notes and "Jetzt aktualisieren") or the error.
 */
export function UpdateSection() {
  const checkForUpdate = useCheckForUpdate();
  const { data: check, error, isPending } = checkForUpdate;

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="outline"
        disabled={isPending}
        focusableWhenDisabled
        aria-busy={isPending || undefined}
        className="data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-background"
        onClick={() =>
          checkForUpdate.mutate(undefined, {
            onError: (cause) => console.error("Update check failed", cause),
          })
        }
      >
        {isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
        {isPending ? m.update_checking() : m.update_check()}
      </Button>
      <p
        role="status"
        className={error ? "max-w-3xl text-sm text-destructive" : "max-w-3xl text-sm"}
      >
        {isPending
          ? null
          : error
            ? updateErrorMessage(error)
            : check
              ? updateCheckMessage(check)
              : null}
      </p>
      {!isPending && check?.updateAvailable && <UpdateActions check={check} />}
    </div>
  );
}
