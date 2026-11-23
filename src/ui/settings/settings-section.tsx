import { type ReactNode, useId } from "react";

import { SectionHeading } from "@/ui/layout/page";

/**
 * One section of the settings page (`/settings`), like a group in the
 * Windows 11 settings: a heading with an optional description above a card
 * that holds the section's content. The page stacks sections ("Steuerjahre" #20,
 * "Stripe" #28); each section owns its data, loading and error states.
 */
export function SettingsSection({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: ReactNode; children: ReactNode }>) {
  const headingId = useId();
  const descriptionId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <SectionHeading id={headingId}>{title}</SectionHeading>
        {description && (
          <p id={descriptionId} className="max-w-3xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}
