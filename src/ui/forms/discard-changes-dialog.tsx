import { useRef } from "react";

import { m } from "@/paraglide/messages.js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/components/ui/alert-dialog";
import { Button } from "@/ui/components/ui/button";

/** Asks before leaving a form with unsaved changes; the safe choice gets the initial focus. */
export function DiscardChangesDialog({
  open,
  onKeep,
  onDiscard,
}: Readonly<{ open: boolean; onKeep: () => void; onDiscard: () => void }>) {
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <AlertDialogContent initialFocus={keepRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.form_discard_title()}</AlertDialogTitle>
          <AlertDialogDescription>{m.form_discard_description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={keepRef}>{m.form_discard_keep()}</AlertDialogCancel>
          <Button variant="destructive" onClick={onDiscard}>
            {m.form_discard_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
