import { type ReactNode, useId } from "react";

/**
 * One section of the settings page (`/einstellungen`): a titled region with
 * an optional description. The page stacks sections ("Steuerjahre" #20,
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
      className="flex flex-col gap-4 rounded-xl border p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="max-w-3xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
