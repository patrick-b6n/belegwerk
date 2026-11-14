import { useForm } from "@tanstack/react-form";
import { useId, useRef } from "react";

import { CATEGORY_NAME_MAX_LENGTH, type CategoryWithUsage } from "@/business/categories";
import type { BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import { BOOKING_TYPE_LABELS } from "@/ui/bookings/booking-messages";
import { Button } from "@/ui/components/ui/button";
import { Checkbox } from "@/ui/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/ui/components/ui/field";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { toast } from "@/ui/components/ui/toast";
import { fieldErrors, focusFirstInvalid, FormField } from "@/ui/forms/form-field";
import { noValidation, revalidateKeepingServerErrorsOnBlur } from "@/ui/forms/validation-logic";

import {
  categoryClientErrorMessage,
  categoryErrorMessage,
  positionDisplay,
} from "./category-messages";
import {
  CATEGORY_TYPES,
  categoryFormValues,
  type CategoryClientError,
  checkName,
  checkPosition,
  errorsByField,
  newCategoryFormValues,
  positionAfterChange,
  positionOptions,
  toChanges,
  toCreateInput,
} from "./category-model";
import { useCategoryMutations } from "./category-mutations";

/** Error text of a client-side check for TanStack Form (`undefined` = valid). */
function message(error: CategoryClientError | undefined): string | undefined {
  return error ? categoryClientErrorMessage(error) : undefined;
}

export interface CategoryFormProps {
  /** The category to edit; without it, the form creates a new category. */
  readonly category?: CategoryWithUsage;
  /** Type a new category starts with. */
  readonly defaultType?: BookingType;
  /** Year whose line numbers the position options show. */
  readonly year: number;
  /** Called after saving (or "not found"): the dialog closes. */
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

/**
 * Create or edit a category (#19), shown in a dialog on `/categories`.
 *
 * - Same validation pattern as the booking form (#18): client checks (name,
 *   position chosen) on submit and then on every change; the service's field
 *   errors at the fields (`errorMap.onServer`), kept on blur.
 * - The type is chosen only on create; afterwards it is shown read-only.
 * - "Mindert Einnahmen" only for expense categories. The position options
 *   depend on type and flag (`positionOptions`, derived from
 *   `validateCategoryPosition`): changing either clears a position that no
 *   longer fits.
 * - System categories: only the name is editable; position and flag are
 *   disabled with a hint.
 */
export function CategoryForm({
  category,
  defaultType = "expense",
  year,
  onDone,
  onCancel,
}: CategoryFormProps) {
  const { create, update } = useCategoryMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const system = category?.isSystem === true;

  const form = useForm({
    defaultValues: category ? categoryFormValues(category) : newCategoryFormValues(defaultType),
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = category
          ? await update.mutateAsync({ id: category.id, changes: toChanges(value, category) })
          : await create.mutateAsync(toCreateInput(value));
        if (result.ok) {
          const name = result.category.name;
          toast.add({
            title: category
              ? m.category_updated_toast({ name })
              : m.category_created_toast({ name }),
            type: "success",
          });
          onDone();
          return;
        }
        if (result.reason === "notFound") {
          toast.add({ title: m.category_not_found_toast(), type: "error" });
          onDone();
          return;
        }
        for (const [field, error] of errorsByField(result.errors)) {
          formApi.setFieldMeta(field, (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: categoryErrorMessage(error) },
            errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
          }));
        }
        focusFirstInvalid(formRef.current);
      } catch (error) {
        console.error("Saving the category failed", error);
        toast.add({ title: m.category_save_error(), type: "error" });
      }
    },
  });

  const idPrefix = useId();
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={category ? m.category_form_label_edit() : m.category_form_label_new()}
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {system && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {m.category_form_system_note()}
        </p>
      )}

      <form.Field name="name" validators={{ onDynamic: ({ value }) => message(checkName(value)) }}>
        {(field) => (
          <FormField
            id={id("name")}
            label={m.category_form_name_label()}
            errors={field.state.meta.errors}
          >
            {(control) => (
              <Input
                {...control}
                required
                autoComplete="off"
                maxLength={CATEGORY_NAME_MAX_LENGTH}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            )}
          </FormField>
        )}
      </form.Field>

      {category ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{m.category_form_type_label()}</span>
          <span>{BOOKING_TYPE_LABELS[category.type]()}</span>
          <span className="text-muted-foreground">{m.category_form_type_fixed()}</span>
        </div>
      ) : (
        <form.Field
          name="type"
          // No client check; lets a change clear a server error (see validation-logic.ts).
          validators={{ onDynamic: noValidation }}
          listeners={{
            onChange: ({ value, fieldApi }) => {
              const { form: api } = fieldApi;
              if (value === "income" && api.getFieldValue("reducesIncome")) {
                api.setFieldValue("reducesIncome", false);
              }
              const position = api.getFieldValue("euerPosition");
              const next = positionAfterChange(position, value, api.getFieldValue("reducesIncome"));
              if (next !== position) api.setFieldValue("euerPosition", next);
            },
          }}
        >
          {(field) => (
            <FormField
              id={id("type")}
              label={m.category_form_type_label()}
              labelAs="group"
              description={m.category_form_type_description()}
              errors={field.state.meta.errors}
            >
              {(control) => (
                <RadioGroup
                  aria-labelledby={`${control.id}-label`}
                  aria-describedby={control["aria-describedby"]}
                  aria-invalid={control["aria-invalid"]}
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as BookingType)}
                  className="flex h-8 items-center gap-6"
                >
                  {CATEGORY_TYPES.map((type) => (
                    <div key={type} className="flex items-center gap-2">
                      <RadioGroupItem
                        id={`${control.id}-${type}`}
                        value={type}
                        onBlur={field.handleBlur}
                      />
                      <Label htmlFor={`${control.id}-${type}`}>{BOOKING_TYPE_LABELS[type]()}</Label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </FormField>
          )}
        </form.Field>
      )}

      <form.Subscribe selector={(state) => state.values.type}>
        {(type) =>
          type === "expense" && (
            <form.Field
              name="reducesIncome"
              validators={{ onDynamic: noValidation }}
              listeners={{
                onChange: ({ value, fieldApi }) => {
                  const { form: api } = fieldApi;
                  const position = api.getFieldValue("euerPosition");
                  const next = positionAfterChange(position, api.getFieldValue("type"), value);
                  if (next !== position) api.setFieldValue("euerPosition", next);
                },
              }}
            >
              {(field) => {
                const errors = fieldErrors(field.state.meta.errors);
                const invalid = errors.length > 0;
                const controlId = id("reducesIncome");
                return (
                  <Field
                    orientation="horizontal"
                    data-invalid={invalid || undefined}
                    data-disabled={system || undefined}
                  >
                    <Checkbox
                      id={controlId}
                      checked={field.state.value}
                      disabled={system}
                      aria-invalid={invalid || undefined}
                      aria-describedby={`${controlId}-description${invalid ? ` ${controlId}-error` : ""}`}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                      onBlur={field.handleBlur}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={controlId}>
                        {m.category_form_reduces_income_label()}
                      </FieldLabel>
                      <FieldDescription id={`${controlId}-description`}>
                        {m.category_form_reduces_income_description()}
                      </FieldDescription>
                      <FieldError id={`${controlId}-error`} role={undefined} errors={errors} />
                    </FieldContent>
                  </Field>
                );
              }}
            </form.Field>
          )
        }
      </form.Subscribe>

      <form.Subscribe
        selector={(state) => [state.values.type, state.values.reducesIncome] as const}
      >
        {([type, reducesIncome]) => (
          <form.Field
            name="euerPosition"
            validators={{ onDynamic: ({ value }) => message(checkPosition(value)) }}
          >
            {(field) => {
              // Only a system category keeps its (fixed, disabled) position regardless of
              // the rules; an editable category is offered only valid positions.
              const options = positionOptions(
                type,
                reducesIncome,
                system ? category?.euerPosition : undefined,
              );
              const items = options.map((position) => ({
                value: position,
                label: positionDisplay(position, year).text,
              }));
              return (
                <FormField
                  id={id("euerPosition")}
                  label={m.category_form_position_label()}
                  description={positionDescription(category, system, reducesIncome)}
                  errors={field.state.meta.errors}
                >
                  {(control) => (
                    <Select<string>
                      items={items}
                      disabled={system}
                      value={field.state.value === "" ? null : field.state.value}
                      onValueChange={(value) => field.handleChange(value ?? "")}
                    >
                      <SelectTrigger {...control} onBlur={field.handleBlur} className="w-full">
                        <SelectValue placeholder={m.category_form_position_placeholder()} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((position) => {
                          const display = positionDisplay(position, year);
                          return (
                            <SelectItem key={position} value={position}>
                              <span className="flex w-full items-baseline justify-between gap-4">
                                <span>{display.name}</span>
                                {display.line !== undefined && (
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {m.categories_line({ line: String(display.line) })}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              );
            }}
          </form.Field>
        )}
      </form.Subscribe>

      <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.common_cancel()}
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? m.category_form_saving()
                : category
                  ? m.category_form_save()
                  : m.category_form_create()}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

/** Hint under the position select. */
function positionDescription(
  category: CategoryWithUsage | undefined,
  system: boolean,
  reducesIncome: boolean,
): string | undefined {
  if (system) return m.category_form_position_system();
  const hints: string[] = [];
  if (reducesIncome) hints.push(m.category_form_position_reduces_income());
  if (category && category.bookingCount > 0) {
    hints.push(m.category_form_position_retroactive({ count: String(category.bookingCount) }));
  }
  return hints.length > 0 ? hints.join(" ") : undefined;
}
