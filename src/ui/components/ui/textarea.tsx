import * as React from "react";
import { cn } from "cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input border-b-input-underline bg-card px-3 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-b-ring focus-visible:shadow-[inset_0_-1px_0_var(--color-ring)] disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:focus-visible:border-b-destructive aria-invalid:focus-visible:shadow-[inset_0_-1px_0_var(--color-destructive)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
