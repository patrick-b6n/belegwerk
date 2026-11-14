import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { BOOKING_TEXT_MAX_LENGTH, type BookingFieldError } from "@/business/bookings";
import type { CategoryWithUsage } from "@/business/categories";
import { formatCurrency, formatDate, parseAmount } from "@/business/format";
import type { Booking, BookingType, VatRate } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/components/ui/alert-dialog";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldError } from "@/ui/components/ui/field";
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
import { Textarea } from "@/ui/components/ui/textarea";
import { toast } from "@/ui/components/ui/toast";
import { fieldErrors, focusFirstInvalid, FormField } from "@/ui/forms/form-field";
import { noValidation, revalidateKeepingServerErrorsOnBlur } from "@/ui/forms/validation-logic";
import { useTaxYear } from "@/ui/tax-years/tax-year-queries";

import {
  BOOKING_SOURCE_LABELS,
  BOOKING_TYPE_LABELS,
  bookingErrorMessage,
  clientErrorMessage,
  VAT_RATE_LABELS,
} from "./booking-messages";
import {
  bookingFormValues,
  categoryAfterTypeChange,
  categoryOptions,
  checkAmount,
  checkCategory,
  checkDate,
  checkRequiredText,
  checkVatRate,
  type ClientFieldError,
  formatAmountInput,
  isTaxOfficeCategory,
  newBookingFormValues,
  previewAmounts,
  splitServiceErrors,
  taxYearOf,
  toBookingFormInput,
  todayIsoDate,
  VAT_RATES,
  vatRateAfterCategoryChange,
} from "./booking-form-model";
import { useBookingMutations } from "./booking-queries";
import { BookingTextInput } from "./booking-text-input";

const BOOKING_TYPES: readonly BookingType[] = ["expense", "income"];

/** Error text of a client-side check for TanStack Form (`undefined` = valid). */
function message(error: ClientFieldError | undefined): string | undefined {
  return error ? clientErrorMessage(error) : undefined;
}

export interface BookingFormProps {
  /** The booking to edit; without it, the form creates a new booking. */
  readonly booking?: Booking;
  /** All categories (`CategoryService.list`); the form filters them. */
  readonly categories: readonly CategoryWithUsage[];
}

/**
 * Create or edit a booking (#18), used by `/buchungen/neu` and
 * `/buchungen/$bookingId`.
 *
 * - Values are strings (`BookingFormValues`); on submit they become the
 *   service's `BookingFormInput` (`toBookingFormInput`). The service
 *   validates everything; its field errors appear at the fields
 *   (`errorMap.onServer`, kept on blur, cleared when the value changes or on
 *   the next submit – every field therefore has a validator), errors of fields
 *   the form does not show (source, external ID) above the buttons.
 * - Client-side checks (required fields, the amount text) run on submit and,
 *   after the first submit, on every change
 *   (`revalidateKeepingServerErrorsOnBlur`).
 * - The VAT rate field is shown only in regularly taxed years – the year
 *   comes from the date; while the date is incomplete the year counts as
 *   regularly taxed. In a small business year the rate is sent as `null`.
 * - After saving or deleting it returns to the list with a toast; "not
 *   found" (deleted meanwhile) likewise, with a message.
 */
export function BookingForm({ booking, categories }: BookingFormProps) {
  const navigate = useNavigate();
  const { create, update } = useBookingMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const otherErrorsRef = useRef<HTMLDivElement>(null);
  const [otherErrors, setOtherErrors] = useState<readonly BookingFieldError[]>([]);

  const form = useForm({
    defaultValues: booking ? bookingFormValues(booking) : newBookingFormValues(todayIsoDate()),
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      setOtherErrors([]);
      const input = toBookingFormInput(value, smallBusinessRef.current);
      try {
        const result = booking
          ? await update.mutateAsync({ id: booking.id, input })
          : await create.mutateAsync(input);
        if (result.ok) {
          toast.add({
            title: booking ? m.booking_updated_toast() : m.booking_created_toast(),
            type: "success",
          });
          await navigate({ to: "/buchungen" });
          return;
        }
        if (result.reason === "notFound") {
          toast.add({ title: m.booking_not_found_toast(), type: "error" });
          await navigate({ to: "/buchungen" });
          return;
        }
        const { byField, other } = splitServiceErrors(result.errors);
        for (const [field, error] of byField) {
          formApi.setFieldMeta(field, (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: bookingErrorMessage(error) },
            errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
          }));
        }
        setOtherErrors(other);
        focusFirstInvalid(formRef.current, otherErrorsRef.current);
      } catch (error) {
        console.error("Saving the booking failed", error);
        toast.add({ title: m.booking_save_error(), type: "error" });
      }
    },
  });

  // Booking type: its texts are suggested first in description and counterparty.
  const bookingType = useStore(form.store, (state) => state.values.type);

  // Tax status of the date's year: decides whether the VAT rate is shown.
  const date = useStore(form.store, (state) => state.values.date);
  const year = taxYearOf(date);
  const taxYear = useTaxYear(year);
  const smallBusiness =
    year !== undefined && taxYear.data?.ok === true && taxYear.data.taxYear.smallBusiness;
  // Read by the VAT validator and on submit (both run outside of render).
  const smallBusinessRef = useRef(smallBusiness);
  useEffect(() => {
    smallBusinessRef.current = smallBusiness;
    // Revalidate the (possibly hidden) VAT rate once errors are shown.
    if (form.state.submissionAttempts > 0) void form.validateField("vatRate", "change");
  }, [form, smallBusiness]);

  const idPrefix = useId();
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={booking ? m.booking_form_label_edit() : m.booking_form_label_new()}
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {booking && booking.source !== "manual" && <ImportInfo booking={booking} />}

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <form.Field
          name="date"
          validators={{ onDynamic: ({ value }) => message(checkDate(value)) }}
        >
          {(field) => (
            <FormField
              id={id("date")}
              label={m.booking_form_date_label()}
              description={m.booking_form_date_description()}
              errors={field.state.meta.errors}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  min="1000-01-01"
                  max="9999-12-31"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  className="w-44"
                />
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field
          name="type"
          // No client check; lets a change clear a server error (see validation-logic.ts).
          validators={{ onDynamic: noValidation }}
          listeners={{
            onChange: ({ value, fieldApi }) => {
              // Keep the category only if it fits the new type.
              const current = fieldApi.form.getFieldValue("categoryId");
              const next = categoryAfterTypeChange(
                current,
                categoryOptions(categories, value, [booking?.categoryId]),
              );
              if (next !== current) fieldApi.form.setFieldValue("categoryId", next);
            },
          }}
        >
          {(field) => (
            <FormField
              id={id("type")}
              label={m.booking_form_type_label()}
              labelAs="group"
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
                  {BOOKING_TYPES.map((type) => (
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

        <form.Field
          name="amount"
          validators={{ onDynamic: ({ value }) => message(checkAmount(value)) }}
        >
          {(field) => (
            <FormField
              id={id("amount")}
              label={m.booking_form_amount_label()}
              description={m.booking_form_amount_description()}
              errors={field.state.meta.errors}
            >
              {(control) => (
                <div className="relative w-44">
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={() => {
                      // Show the recognized amount in its canonical form
                      // ("1.500" → "1.500,00"): the dot is a thousands separator.
                      const parsed = parseAmount(field.state.value);
                      if (parsed.ok && parsed.cents > 0) {
                        const canonical = formatAmountInput(parsed.cents);
                        if (canonical !== field.state.value) field.handleChange(canonical);
                      }
                      field.handleBlur();
                    }}
                    className="pr-7 text-right tabular-nums"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground"
                  >
                    €
                  </span>
                </div>
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field
          name="vatRate"
          validators={{
            onDynamic: ({ value }) => message(checkVatRate(value, smallBusinessRef.current)),
          }}
        >
          {(field) =>
            smallBusiness ? (
              <SmallBusinessNote
                id={id("vatRate")}
                year={year}
                errors={fieldErrors(field.state.meta.errors)}
              />
            ) : (
              <FormField
                id={id("vatRate")}
                label={m.booking_form_vat_rate_label()}
                errors={field.state.meta.errors}
              >
                {(control) => (
                  <Select<VatRate>
                    items={VAT_RATES.map((rate) => ({
                      value: rate,
                      label: VAT_RATE_LABELS[rate](),
                    }))}
                    value={field.state.value === "" ? null : field.state.value}
                    onValueChange={(value) => field.handleChange(value ?? "")}
                  >
                    <SelectTrigger {...control} onBlur={field.handleBlur} className="w-44">
                      <SelectValue placeholder={m.booking_form_vat_rate_placeholder()} />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_RATES.map((rate) => (
                        <SelectItem key={rate} value={rate}>
                          {VAT_RATE_LABELS[rate]()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )
          }
        </form.Field>

        <form.Subscribe selector={(state) => [state.values.amount, state.values.vatRate] as const}>
          {([amount, vatRate]) => (
            <AmountPreview amount={amount} vatRate={vatRate} smallBusiness={smallBusiness} />
          )}
        </form.Subscribe>

        <form.Subscribe selector={(state) => state.values.type}>
          {(type) => (
            <form.Field
              name="categoryId"
              validators={{ onDynamic: ({ value }) => message(checkCategory(value)) }}
            >
              {(field) => {
                const options = categoryOptions(categories, type, [
                  booking?.categoryId,
                  Number(field.state.value),
                ]);
                const items = options.map((category) => ({
                  value: String(category.id),
                  label: category.archived
                    ? m.booking_form_category_archived({ name: category.name })
                    : category.name,
                }));
                return (
                  <FormField
                    id={id("categoryId")}
                    label={m.booking_form_category_label()}
                    description={
                      options.length === 0
                        ? m.booking_form_category_none()
                        : !smallBusiness && isTaxOfficeCategory(field.state.value, categories)
                          ? m.booking_form_category_tax_office_hint()
                          : undefined
                    }
                    errors={field.state.meta.errors}
                    className="sm:col-span-2"
                  >
                    {(control) => (
                      <Select<string>
                        items={items}
                        value={field.state.value === "" ? null : field.state.value}
                        onValueChange={(value) => {
                          const next = value ?? "";
                          field.handleChange(next);
                          // Tax-office payments contain no VAT: suggest rate 0.
                          const current = field.form.getFieldValue("vatRate");
                          const rate = vatRateAfterCategoryChange(next, categories, current);
                          if (rate !== current) field.form.setFieldValue("vatRate", rate);
                        }}
                      >
                        <SelectTrigger
                          {...control}
                          onBlur={field.handleBlur}
                          className="w-full sm:w-96"
                        >
                          <SelectValue placeholder={m.booking_form_category_placeholder()} />
                        </SelectTrigger>
                        <SelectContent>
                          {items.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                );
              }}
            </form.Field>
          )}
        </form.Subscribe>

        <form.Field
          name="description"
          validators={{
            onDynamic: ({ value }) => message(checkRequiredText("description", value)),
          }}
        >
          {(field) => (
            <FormField
              id={id("description")}
              label={m.booking_form_description_label()}
              errors={field.state.meta.errors}
              className="sm:col-span-2"
            >
              {(control) => (
                <BookingTextInput
                  field="description"
                  type={bookingType}
                  control={control}
                  maxLength={BOOKING_TEXT_MAX_LENGTH.description}
                  listLabel={m.booking_form_description_suggestions()}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field
          name="counterparty"
          validators={{
            onDynamic: ({ value }) => message(checkRequiredText("counterparty", value)),
          }}
        >
          {(field) => (
            <FormField
              id={id("counterparty")}
              label={m.booking_form_counterparty_label()}
              description={m.booking_form_counterparty_description()}
              errors={field.state.meta.errors}
            >
              {(control) => (
                <BookingTextInput
                  field="counterparty"
                  type={bookingType}
                  control={control}
                  maxLength={BOOKING_TEXT_MAX_LENGTH.counterparty}
                  listLabel={m.booking_form_counterparty_suggestions()}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field name="reference" validators={{ onDynamic: noValidation }}>
          {(field) => (
            <FormField
              id={id("reference")}
              label={m.booking_form_reference_label()}
              description={m.booking_form_reference_description()}
              errors={field.state.meta.errors}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={BOOKING_TEXT_MAX_LENGTH.reference}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            </FormField>
          )}
        </form.Field>

        <form.Field name="note" validators={{ onDynamic: noValidation }}>
          {(field) => (
            <FormField
              id={id("note")}
              label={m.booking_form_note_label()}
              description={m.booking_form_note_description()}
              errors={field.state.meta.errors}
              className="sm:col-span-2"
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  maxLength={BOOKING_TEXT_MAX_LENGTH.note}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            </FormField>
          )}
        </form.Field>
      </div>

      {otherErrors.length > 0 && (
        <div
          ref={otherErrorsRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive outline-none"
        >
          <p>{m.booking_form_other_errors()}</p>
          <ul className="ml-4 list-disc">
            {otherErrors.map((error) => (
              <li key={error.field}>{bookingErrorMessage(error)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Sticky at the bottom of the scrolling content area: save/cancel stay
          reachable when the window is too low for the whole form. */}
      <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center gap-3 bg-background px-2 py-3">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? m.booking_form_saving()
                : booking
                  ? m.booking_form_save()
                  : m.booking_form_create()}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="outline" onClick={() => void navigate({ to: "/buchungen" })}>
          {m.common_cancel()}
        </Button>
        {booking && (
          <div className="ml-auto">
            <DeleteBookingButton booking={booking} />
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * Shown instead of the VAT rate in small business years. Its errors (e.g.
 * `vatRateNotAllowed` from the service) still show here; with an error the
 * note is focusable and marked invalid, so the focus after a failed submit
 * lands on it (`focusFirstInvalid`).
 */
function SmallBusinessNote({
  id,
  year,
  errors,
}: Readonly<{ id: string; year: number | undefined; errors: { message: string }[] }>) {
  const invalid = errors.length > 0;
  return (
    <Field data-invalid={invalid || undefined}>
      <p
        id={id}
        tabIndex={invalid ? -1 : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className="rounded-sm text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mt-6"
      >
        {m.booking_form_small_business_note({ year: String(year) })}
      </p>
      <FieldError id={`${id}-error`} role={undefined} errors={errors} />
    </Field>
  );
}

function previewValue(cents: number | undefined): string {
  return cents === undefined ? m.booking_form_preview_unavailable() : formatCurrency(cents);
}

/** Live net/VAT preview, computed like the service (`calculateBookingAmounts`). */
function AmountPreview({
  amount,
  vatRate,
  smallBusiness,
}: Readonly<{ amount: string; vatRate: VatRate | ""; smallBusiness: boolean }>) {
  const preview = previewAmounts(amount, vatRate, smallBusiness);
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm sm:col-span-2">
      <span className="sr-only">{m.booking_form_preview_label()}: </span>
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {(
          [
            [m.bookings_column_net(), preview?.netCents],
            [m.bookings_column_vat(), preview?.vatCents],
            [m.bookings_column_gross(), preview?.grossCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{previewValue(cents)}</dd>
          </div>
        ))}
      </dl>
      {!preview && (
        <p className="mt-1 text-xs text-muted-foreground">
          {m.booking_form_preview_unavailable_description()}
        </p>
      )}
    </div>
  );
}

/** Source and external ID of an imported booking: informational, not editable. */
function ImportInfo({ booking }: Readonly<{ booking: Booking }>) {
  return (
    <section className="rounded-lg border p-3 text-sm">
      <h2 className="font-medium">{m.booking_form_import_title()}</h2>
      <p className="text-muted-foreground">{m.booking_form_import_description()}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{m.booking_form_source_label()}</dt>
        <dd>{BOOKING_SOURCE_LABELS[booking.source]()}</dd>
        {booking.externalId !== null && (
          <>
            <dt className="text-muted-foreground">{m.booking_form_external_id_label()}</dt>
            <dd className="font-mono break-all">{booking.externalId}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

/** "Löschen" with a confirmation dialog; on success back to the list. */
function DeleteBookingButton({ booking }: Readonly<{ booking: Booking }>) {
  const navigate = useNavigate();
  const { remove } = useBookingMutations();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    try {
      const result = await remove.mutateAsync(booking.id);
      toast.add(
        result.ok
          ? { title: m.booking_deleted_toast(), type: "success" }
          : { title: m.booking_not_found_toast(), type: "error" },
      );
      setOpen(false);
      await navigate({ to: "/buchungen" });
    } catch (error) {
      console.error("Deleting the booking failed", error);
      toast.add({ title: m.booking_delete_error(), type: "error" });
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !remove.isPending && setOpen(next)}>
      <AlertDialogTrigger render={<Button type="button" variant="destructive" />}>
        {m.booking_delete()}
      </AlertDialogTrigger>
      {/* Destructive: the safe choice gets the initial focus. */}
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.booking_delete_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.booking_delete_description({
              description: booking.description,
              date: formatDate(booking.date),
              amount: formatCurrency(booking.grossCents),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={remove.isPending}>
            {m.common_cancel()}
          </AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => void confirm()}>
            {remove.isPending ? m.booking_deleting() : m.booking_delete_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
