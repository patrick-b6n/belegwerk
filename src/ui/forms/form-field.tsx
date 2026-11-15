import { cn } from "cn";
import type { ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/ui/components/ui/field";

/**
 * Shared building blocks of the TanStack Form forms (booking form #18,
 * category form #19).
 */

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

/** Props a form control gets from {@link FormField}. */
export interface ControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Label, description, control and error of one form field (shadcn `Field`);
 * the description sits right below the label.
 * The control gets `id`, `aria-invalid` and `aria-describedby` (description
 * and error), so screen readers announce the error with the field.
 */
export function FormField({
  id,
  label,
  labelAs = "label",
  description,
  errors,
  className,
  children,
}: Readonly<{
  id: string;
  label: string;
  /** `"group"`: a group of controls (radio buttons) labelled via `aria-labelledby`. */
  labelAs?: "label" | "group";
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
  return (
    <Field data-invalid={invalid || undefined} className={cn("gap-1", className)}>
      {labelAs === "label" ? (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      ) : (
        <FieldTitle id={`${id}-label`}>{label}</FieldTitle>
      )}
      {description && (
        <FieldDescription id={descriptionId} className="-mt-1! text-xs">
          {description}
        </FieldDescription>
      )}
      {children({ id, "aria-invalid": invalid || undefined, "aria-describedby": describedBy })}
      {/* No live region: the error is linked to the control and focused on submit. */}
      <FieldError id={errorId} role={undefined} errors={shown} />
    </Field>
  );
}
