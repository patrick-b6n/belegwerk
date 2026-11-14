import { X } from "lucide-react";
import { useId, useState } from "react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

import { UpdateActions } from "./update-actions";
import { useBackgroundUpdateCheck } from "./update-queries";

/**
 * Notice in the side navigation when a newer version is available (#71).
 * The check runs once in the background at startup; without network or on
 * GitHub errors nothing appears (only a log entry). "Hinweis ausblenden"
 * hides it for that version until the next start; only a newer version
 * (e.g. found by "Nach Updates suchen" in the settings) brings it back.
 */
export function UpdateNotice() {
  const { data: check } = useBackgroundUpdateCheck();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const titleId = useId();

  if (!check?.updateAvailable || dismissedVersion === check.latestVersion) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="relative flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm text-foreground"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={m.update_notice_dismiss()}
        title={m.update_notice_dismiss()}
        className="absolute top-1.5 right-1.5"
        onClick={() => setDismissedVersion(check.latestVersion)}
      >
        <X aria-hidden />
      </Button>
      <h2 id={titleId} className="pr-6 font-medium">
        {m.update_notice_title()}
      </h2>
      <p className="text-muted-foreground">
        {m.update_notice_version({ version: check.latestVersion })}
      </p>
      <UpdateActions check={check} compact />
    </section>
  );
}
