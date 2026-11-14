import { useForm } from "@tanstack/react-form";
import { AlertTriangle } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { SetSmallBusinessResult, TaxYearOverview } from "@/business/tax-years";
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
import { Input } from "@/ui/components/ui/input";
import { Switch } from "@/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";
import { toast } from "@/ui/components/ui/toast";
import { focusFirstInvalid, FormField } from "@/ui/forms/form-field";
import { revalidateKeepingServerErrorsOnBlur } from "@/ui/forms/validation-logic";

import {
  conflictDescription,
  mismatchedBookingsHint,
  taxStatusLabel,
  taxStatusSavedMessage,
  taxYearClientErrorMessage,
  taxYearErrorMessage,
} from "./tax-year-messages";
import {
  checkYear,
  parseYear,
  sortYearsAscending,
  suggestedYear,
  yearError,
} from "./tax-year-model";
import { useTaxYearMutations } from "./tax-year-mutations";
import { useTaxYearList } from "./tax-year-queries";

/**
 * The "Steuerjahre" section of the settings page (#20): all years with a
 * record or bookings (oldest first), each with its status and a
 * Kleinunternehmer switch, plus "Add year".
 */
export function TaxYearSettings() {
  const { data, error, isPending, refetch } = useTaxYearList();
  // The current year, fixed while the page is open.
  const [currentYear] = useState(() => new Date().getFullYear());

  if (isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.tax_years_loading()}
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.tax_years_load_error()}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  const years = sortYearsAscending(data);
  const listed = years.map((taxYear) => taxYear.year);
  return (
    <div className="flex flex-col gap-6">
      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.tax_years_empty()}</p>
      ) : (
        <TaxYearTable years={years} />
      )}
      <AddTaxYearForm listed={listed} currentYear={currentYear} />
    </div>
  );
}

function TaxYearTable({ years }: Readonly<{ years: readonly TaxYearOverview[] }>) {
  return (
    <Table className="table-fixed">
      <TableCaption className="sr-only">{m.tax_years_title()}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">{m.tax_years_column_year()}</TableHead>
          <TableHead>{m.tax_years_column_status()}</TableHead>
          <TableHead className="w-40">{m.tax_years_column_small_business()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {years.map((taxYear) => (
          <TaxYearRow key={taxYear.year} taxYear={taxYear} />
        ))}
      </TableBody>
    </Table>
  );
}

/** A change the service refused with `conflicts`, waiting for the user's decision. */
interface PendingConflict {
  readonly smallBusiness: boolean;
  readonly mismatchedBookings: number;
}

/**
 * One year. Toggling the switch saves immediately; while saving (and while
 * the conflict dialog is open) the switch shows the new value and is
 * read-only. If the service reports `conflicts`, a dialog explains them:
 * "Change anyway" repeats with `acknowledgeConflicts`, "Cancel" reverts
 * the switch. The row keeps showing remaining mismatched bookings (from
 * `list()`), so the hint persists until the bookings are corrected.
 */
function TaxYearRow({ taxYear }: Readonly<{ taxYear: TaxYearOverview }>) {
  const { year } = taxYear;
  const { setSmallBusiness } = useTaxYearMutations();
  // The value being saved or confirmed; `null` = show the stored status.
  const [target, setTarget] = useState<boolean | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const hintId = useId();
  const checked = target ?? taxYear.smallBusiness;

  const save = async (smallBusiness: boolean, acknowledgeConflicts: boolean) => {
    setTarget(smallBusiness);
    let result: SetSmallBusinessResult;
    try {
      result = await setSmallBusiness.mutateAsync({ year, smallBusiness, acknowledgeConflicts });
    } catch (error) {
      console.error("Saving the tax status failed", error);
      toast.add({ title: m.tax_years_save_error(), type: "error" });
      setConflict(null);
      setTarget(null);
      return;
    }
    if (result.ok) {
      toast.add({ title: taxStatusSavedMessage(year, smallBusiness), type: "success" });
      setConflict(null);
      // The list was refetched before `mutateAsync` resolved: no flicker back.
      setTarget(null);
      return;
    }
    switch (result.reason) {
      case "conflicts":
        // The switch keeps showing the new value until the user decides.
        setConflict({ smallBusiness, mismatchedBookings: result.mismatchedBookings });
        return;
      case "invalid":
        toast.add({
          title: result.errors.map(taxYearErrorMessage).join(" "),
          type: "error",
        });
        setConflict(null);
        setTarget(null);
        return;
    }
  };

  const cancelConflict = () => {
    setConflict(null);
    setTarget(null);
  };

  const hasHint = !taxYear.explicit || taxYear.mismatchedBookings > 0;

  return (
    <TableRow data-year={year}>
      <TableCell className="font-medium tabular-nums">{year}</TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{taxStatusLabel(taxYear.smallBusiness)}</span>
            {!taxYear.explicit && (
              <span
                title={m.tax_years_default_title()}
                className="shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground"
              >
                {m.tax_years_default()}
              </span>
            )}
          </span>
          {hasHint && (
            <span id={hintId} className="flex flex-col gap-1 text-sm">
              {!taxYear.explicit && <span className="sr-only">{m.tax_years_default_title()}</span>}
              {taxYear.mismatchedBookings > 0 && (
                <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {mismatchedBookingsHint(taxYear.mismatchedBookings, taxYear.smallBusiness)}
                </span>
              )}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={checked}
          // Read-only (not disabled) while busy, so keyboard focus stays on the switch.
          readOnly={target !== null}
          aria-label={m.tax_years_switch_label({ year: String(year) })}
          aria-describedby={hasHint ? hintId : undefined}
          onCheckedChange={(value) => void save(value, false)}
        />
        <ConflictDialog
          year={year}
          conflict={conflict}
          saving={setSmallBusiness.isPending}
          onCancel={cancelConflict}
          onConfirm={() => conflict && void save(conflict.smallBusiness, true)}
        />
      </TableCell>
    </TableRow>
  );
}

/**
 * Explains that bookings of the year will not fit the new status; they keep
 * their data and must be corrected on their next edit. The safe choice
 * ("Cancel", reverts the switch) gets the initial focus.
 */
function ConflictDialog({
  year,
  conflict,
  saving,
  onCancel,
  onConfirm,
}: Readonly<{
  year: number;
  conflict: PendingConflict | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Keeps the text while the dialog animates out.
  const [shown, setShown] = useState(conflict);
  if (conflict && conflict !== shown) setShown(conflict);

  return (
    <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && !saving && onCancel()}>
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.tax_years_conflict_title({ year: String(year) })}</AlertDialogTitle>
          <AlertDialogDescription>
            {shown && conflictDescription(year, shown.smallBusiness, shown.mismatchedBookings)}{" "}
            {m.tax_years_conflict_keep()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={saving}>
            {m.common_cancel()}
          </AlertDialogCancel>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? m.tax_years_conflict_saving() : m.tax_years_conflict_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * "Add year": records a year as regularly taxed. Starts with the
 * current year (or the next one) if it is not listed. Same validation
 * pattern as the other forms: client check on submit and then on every
 * change; the service's `yearExists`/`invalidYear` at the field.
 */
function AddTaxYearForm({
  listed,
  currentYear,
}: Readonly<{ listed: readonly number[]; currentYear: number }>) {
  const { addYear } = useTaxYearMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  const form = useForm({
    defaultValues: { year: suggestedYear(listed, currentYear) },
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await addYear.mutateAsync(parseYear(value.year));
        if (result.ok) {
          const added = result.taxYear.year;
          toast.add({ title: m.tax_years_added_toast({ year: String(added) }), type: "success" });
          formApi.reset({ year: suggestedYear([...listed, added], currentYear) });
          return;
        }
        const error = yearError(result.errors);
        if (!error) throw new Error(`Unexpected addYear result ${JSON.stringify(result)}`);
        formApi.setFieldMeta("year", (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onServer: taxYearErrorMessage(error) },
          errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
        }));
        focusFirstInvalid(formRef.current);
      } catch (error) {
        console.error("Adding the tax year failed", error);
        toast.add({ title: m.tax_years_add_error(), type: "error" });
      }
    },
  });

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={m.tax_years_add_label()}
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="year"
        validators={{
          onDynamic: ({ value }) => {
            const error = checkYear(value);
            return error ? taxYearClientErrorMessage(error) : undefined;
          },
        }}
      >
        {(field) => (
          <FormField
            id={`${id}-year`}
            label={m.tax_years_add_label()}
            description={m.tax_years_add_description()}
            errors={field.state.meta.errors}
            className="w-auto max-w-md"
          >
            {(control) => (
              <div className="flex gap-2">
                <Input
                  {...control}
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  className="w-24 tabular-nums"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Button type="submit" variant="outline" disabled={isSubmitting}>
                      {isSubmitting ? m.tax_years_adding() : m.tax_years_add_submit()}
                    </Button>
                  )}
                </form.Subscribe>
              </div>
            )}
          </FormField>
        )}
      </form.Field>
    </form>
  );
}
