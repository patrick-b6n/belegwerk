import { RefreshCw } from "lucide-react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

import { UpdateActions } from "./update-actions";
import { updateCheckMessage, updateErrorMessage } from "./update-messages";
import { useCheckForUpdate } from "./update-queries";

export function UpdateSection() {
  const checkForUpdate = useCheckForUpdate();
  const { data: check, error, isPending } = checkForUpdate;

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="outline"
        busy={isPending}
        onClick={() =>
          checkForUpdate.mutate(undefined, {
            onError: (cause) => console.error("Update check failed", cause),
          })
        }
      >
        <RefreshCw aria-hidden />
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
