import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/components/ui/popover";

import { UpdateActions } from "./update-actions";
import { useBackgroundUpdateCheck } from "./update-queries";

/**
 * Notice in the top bar when a newer version is available (#71): a small
 * "Update verfügbar" pill that opens the version and the update actions.
 * The check runs once in the background at startup; without network or on
 * GitHub errors nothing appears (only a log entry). "Hinweis ausblenden"
 * hides it for that version until the next start; only a newer version
 * (e.g. found by "Check for updates" in the settings) brings it back.
 */
export function UpdateNotice() {
  const { data: check } = useBackgroundUpdateCheck();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  if (!check?.updateAvailable || dismissedVersion === check.latestVersion) return null;

  return (
    <Popover>
      <PopoverTrigger className="flex h-7 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-xs font-medium text-amber-900 outline-none hover:bg-amber-200 focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900">
        <span aria-hidden className="size-1.5 rounded-full bg-chart-2" />
        {m.update_notice_title()}
      </PopoverTrigger>
      <PopoverContent align="end" className="gap-3">
        <div className="flex flex-col gap-1">
          <PopoverTitle>{m.update_notice_title()}</PopoverTitle>
          <PopoverDescription>
            {m.update_notice_version({ version: check.latestVersion })}
          </PopoverDescription>
        </div>
        <UpdateActions check={check} compact />
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => setDismissedVersion(check.latestVersion)}
        >
          {m.update_notice_dismiss()}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
