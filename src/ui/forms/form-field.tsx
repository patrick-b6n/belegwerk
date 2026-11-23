import { cn } from "cn";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/ui/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/ui/tooltip";

/** The (string) errors of a field, deduplicated, for `FieldError`. */
export function fieldErrors(errors: readonly unknown[]): { message: string }[] {
  return [...new Set(errors.filter((error): error is string => typeof error === "string"))].map(
    (text) => ({ message: text }),
  );
}

/**
 * Moves the focus to the first invalid control once React has rendered the
 * errors – or to `fallback` (e.g. the summary of errors without a field).
 */
export function focusFirstInvalid(form: HTMLFormElement | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const invalid = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? fallback)?.focus();
  });
}

export interface ControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Label, control and error of one form field (shadcn `Field`). `required`
 * marks the label with an asterisk (and "Pflichtfeld" for screen readers).
 * The description is behind an info icon next to the label
 * (tooltip on hover and focus); for screen readers it stays linked to the
 * control. The control gets `id`, `aria-invalid` and `aria-describedby`
 * (description and error), so screen readers announce the error with the
 * field.
 */
export function FormField({
  id,
  label,
  labelAs = "label",
  required = false,
  description,
  errors,
  className,
  children,
}: Readonly<{
  id: string;
  label: string;
  /** `"group"`: a group of controls (radio buttons) labelled via `aria-labelledby`. */
  labelAs?: "label" | "group";
  required?: boolean;
  description?: ReactNode;
  errors: readonly unknown[];
  className?: string;
  children: (control: ControlProps) => ReactNode;
}>) {
  const shown = fieldErrors(errors);
  const invalid = shown.length > 0;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = invalid ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const labelContent = (
    <>
      {label}
      {required && (
        <>
          <span aria-hidden className="-ml-1.5 text-destructive">
            *
          </span>
          <span className="sr-only">{m.form_field_required()}</span>
        </>
      )}
    </>
  );
  return (
    <Field data-invalid={invalid || undefined} className={cn("gap-1", className)}>
      <div className="flex items-center gap-1.5">
        {labelAs === "label" ? (
          <FieldLabel htmlFor={id}>{labelContent}</FieldLabel>
        ) : (
          <FieldTitle id={`${id}-label`}>{labelContent}</FieldTitle>
        )}
        {description && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={m.form_field_hint({ label })}
                  className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <Info aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              {description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {description && (
        <FieldDescription id={descriptionId} className="sr-only">
          {description}
        </FieldDescription>
      )}
      {children({ id, "aria-invalid": invalid || undefined, "aria-describedby": describedBy })}
      {/* No live region: the error is linked to the control and focused on submit. */}
      <FieldError id={errorId} role={undefined} errors={shown} />
    </Field>
  );
}
