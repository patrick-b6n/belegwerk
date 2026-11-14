import { useForm } from "@tanstack/react-form";
import { cn } from "cn";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CloudDownload, Loader2 } from "lucide-react";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";

import { formatDate } from "@/business/format";
import {
  type StripeImportStatus,
  type StripeKeyMode,
  validateStripeDefaults,
} from "@/business/stripe";
import { m } from "@/paraglide/messages.js";
import { useCategoryList } from "@/ui/categories/category-queries";
import { Button, buttonVariants } from "@/ui/components/ui/button";
import { Checkbox } from "@/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/ui/dialog";
import { Field, FieldContent, FieldError, FieldLabel } from "@/ui/components/ui/field";
import { Input } from "@/ui/components/ui/input";
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
import {
  type ControlProps,
  fieldErrors,
  focusFirstInvalid,
  FormField,
} from "@/ui/forms/form-field";
import { revalidateKeepingServerErrorsOnBlur } from "@/ui/forms/validation-logic";

import {
  berlinTodayIsoDate,
  checkImportFrom,
  checkImportTo,
  formatImportTimestamp,
  importedBookingsSearch,
  importErrorsByField,
  stripeImportFormValues,
  type StripeImportSummary,
  stripeImportSummary,
} from "./stripe-import-model";
import {
  importFailureReason,
  importFieldErrorMessage,
  importKindLabel,
  stripeClientErrorMessage,
} from "./stripe-messages";
import { useStripeImport } from "./stripe-mutations";
import { useStripeImportStatus, useStripeSettings } from "./stripe-queries";

/**
 * "Stripe importieren" (#31) in the header of the booking list: opens the
 * import dialog.
 *
 * - Without a key, or with missing/invalid defaults, the dialog only explains
 *   and links to the settings.
 * - With a **test** key it warns that test fees would be booked as real
 *   bookings and asks for an explicit confirmation.
 * - Period „seit dem letzten Import“ by default (`defaultImportPeriod`);
 *   client checks mirror the service, its field errors appear at the fields.
 * - While the import runs the dialog cannot be closed (`aria-busy`, no close
 *   button, Escape and outside clicks ignored) – the import is all or nothing
 *   and cannot be cancelled.
 * - Afterwards a summary "X new, Y skipped" with the entries not booked
 *   and a link to the imported bookings.
 */
export function StripeImportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A new panel (fresh form and result) for every opening.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setSession((count) => count + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant="outline" title={m.stripe_import_button_hint()} />}>
        <CloudDownload aria-hidden />
        {m.stripe_import_button()}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!busy} aria-busy={busy || undefined}>
        <DialogHeader>
          <DialogTitle>{m.stripe_import_title()}</DialogTitle>
          <DialogDescription>{m.stripe_import_description()}</DialogDescription>
        </DialogHeader>
        <StripeImportPanel key={session} onBusyChange={setBusy} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Loads settings, categories (validity of the defaults) and the import status. */
function StripeImportPanel({
  onBusyChange,
  onClose,
}: Readonly<{ onBusyChange: (busy: boolean) => void; onClose: () => void }>) {
  const settings = useStripeSettings();
  const categories = useCategoryList();
  const status = useStripeImportStatus();
  const [summary, setSummary] = useState<StripeImportSummary | null>(null);
  // Announced by screen readers: progress and the result (the region exists
  // before its text changes, so the change is read).
  const [announcement, setAnnouncement] = useState("");
  // Set when an import starts: a settings hint shown afterwards replaced the
  // form (the service reported `noApiKey`/`invalidDefaults` and the settings
  // were reloaded), so it takes the focus of the form's unmounted alert.
  const [attempted, setAttempted] = useState(false);

  let content;
  if (summary) {
    content = <ImportSummaryView summary={summary} onClose={onClose} />;
  } else if (settings.isPending || categories.isPending || status.isPending) {
    content = (
      <p role="status" className="text-muted-foreground">
        {m.stripe_import_loading()}
      </p>
    );
  } else if (settings.error || categories.error || status.error) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.stripe_import_load_error()}</p>
        <Button
          variant="outline"
          onClick={() =>
            void Promise.all([settings.refetch(), categories.refetch(), status.refetch()])
          }
        >
          {m.common_retry()}
        </Button>
      </div>
    );
  } else if (settings.data.apiKey === null) {
    content = <SettingsHint text={m.stripe_import_no_key()} focus={attempted} onClose={onClose} />;
  } else if (validateStripeDefaults(settings.data.defaults, categories.data).length > 0) {
    content = (
      <SettingsHint text={m.stripe_import_invalid_defaults()} focus={attempted} onClose={onClose} />
    );
  } else {
    content = (
      <StripeImportForm
        keyMode={settings.data.apiKey.mode}
        status={status.data}
        onRunningChange={(running) => {
          onBusyChange(running);
          if (running) {
            setAttempted(true);
            setAnnouncement(m.stripe_import_running());
          }
        }}
        onDone={(result) => {
          setSummary(result);
          setAnnouncement(m.stripe_import_done_announcement({ counts: countsText(result) }));
        }}
        onFailed={() => setAnnouncement("")}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {content}
    </div>
  );
}

function Warning({ className, children, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      {...props}
      className={cn(
        "flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
        className,
      )}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * No key or no valid defaults: explain and link to the settings. With
 * `focus` (it replaced the form after an import attempt) it is an alert and
 * takes the focus on mount.
 */
function SettingsHint({
  text,
  focus,
  onClose,
}: Readonly<{ text: string; focus: boolean; onClose: () => void }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <>
      <Warning ref={ref} tabIndex={-1} role={focus ? "alert" : undefined} className="outline-none">
        <p>{text}</p>
      </Warning>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {m.common_close()}
        </Button>
        <Link to="/settings" className={buttonVariants()} onClick={onClose}>
          {m.stripe_import_to_settings()}
        </Link>
      </DialogFooter>
    </>
  );
}

/** An error of the whole import (not of a field), shown above the buttons. */
type ImportError = { readonly text: string; readonly settingsLink: boolean };

function StripeImportForm({
  keyMode,
  status,
  onRunningChange,
  onDone,
  onFailed,
  onCancel,
}: Readonly<{
  keyMode: StripeKeyMode;
  status: StripeImportStatus;
  onRunningChange: (running: boolean) => void;
  onDone: (summary: StripeImportSummary) => void;
  onFailed: () => void;
  onCancel: () => void;
}>) {
  const stripeImport = useStripeImport();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // The latest period end the import accepts (max of the date fields, client
  // check `inFuture`). Fixed when the dialog opens and kept while it is open
  // (also across midnight); the service checks the real date on import.
  const [today] = useState(() => berlinTodayIsoDate());
  const [importError, setImportError] = useState<ImportError | null>(null);
  const testMode = keyMode === "test";

  const fail = (error: ImportError) => {
    setImportError(error);
    onFailed();
    requestAnimationFrame(() => errorRef.current?.focus());
  };

  const form = useForm({
    defaultValues: stripeImportFormValues(status, today),
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      setImportError(null);
      onRunningChange(true);
      try {
        const result = await stripeImport.mutateAsync({ from: value.from, to: value.to });
        if (result.ok) {
          onDone(stripeImportSummary(result));
          return;
        }
        switch (result.reason) {
          case "invalid":
            for (const [field, error] of importErrorsByField(result.errors)) {
              formApi.setFieldMeta(field, (meta) => ({
                ...meta,
                errorMap: { ...meta.errorMap, onServer: importFieldErrorMessage(error) },
                errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
              }));
            }
            onFailed();
            focusFirstInvalid(formRef.current);
            break;
          case "noApiKey":
            fail({ text: m.stripe_import_no_key(), settingsLink: true });
            break;
          case "invalidDefaults":
            fail({ text: m.stripe_import_invalid_defaults(), settingsLink: true });
            break;
          case "settingsChanged":
            fail({ text: m.stripe_import_settings_changed(), settingsLink: false });
            break;
          case "stripe":
            fail({ text: stripeClientErrorMessage(result.error), settingsLink: false });
            break;
        }
      } catch (error) {
        // Rolled back: nothing was booked.
        console.error("Stripe import failed", error);
        toast.add({ title: m.stripe_import_failed_toast(), type: "error" });
        fail({ text: m.stripe_import_error(), settingsLink: false });
      } finally {
        onRunningChange(false);
      }
    },
  });

  const idPrefix = useId();
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={m.stripe_import_title()}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(running) => (
          <>
            {testMode && (
              <Warning id={id("test-warning")}>
                <p className="font-medium">{m.stripe_import_test_warning_title()}</p>
                <p>{m.stripe_import_test_warning()}</p>
              </Warning>
            )}

            <p className="text-sm text-muted-foreground">
              {status.lastImportTo === null
                ? m.stripe_import_last_never()
                : m.stripe_import_last({
                    at:
                      status.lastImportAt === null
                        ? "–"
                        : formatImportTimestamp(status.lastImportAt),
                    to: formatDate(status.lastImportTo),
                  })}
            </p>

            <div className="flex flex-col gap-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field
                  name="from"
                  validators={{
                    onDynamic: ({ value }) => {
                      const error = checkImportFrom(value);
                      return error ? importFieldErrorMessage(error) : undefined;
                    },
                  }}
                  listeners={{
                    // `to` is checked against `from`.
                    onChange: ({ fieldApi }) => void fieldApi.form.validateField("to", "change"),
                  }}
                >
                  {(field) => (
                    <FormField
                      id={id("from")}
                      label={m.stripe_import_from_label()}
                      errors={field.state.meta.errors}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          aria-describedby={describedBy(control, id("period-description"))}
                          type="date"
                          required
                          max={today}
                          disabled={running}
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <form.Field
                  name="to"
                  validators={{
                    onDynamic: ({ value, fieldApi }) => {
                      const error = checkImportTo(
                        value,
                        fieldApi.form.getFieldValue("from"),
                        today,
                      );
                      return error ? importFieldErrorMessage(error) : undefined;
                    },
                  }}
                >
                  {(field) => (
                    <FormField
                      id={id("to")}
                      label={m.stripe_import_to_label()}
                      errors={field.state.meta.errors}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          aria-describedby={describedBy(control, id("period-description"))}
                          type="date"
                          required
                          max={today}
                          disabled={running}
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
              </div>
              <p id={id("period-description")} className="text-sm text-muted-foreground">
                {m.stripe_import_period_description()}
              </p>
            </div>

            {testMode && (
              <form.Field
                name="confirmTestMode"
                validators={{
                  onDynamic: ({ value }) =>
                    value ? undefined : m.stripe_import_test_confirm_required(),
                }}
              >
                {(field) => {
                  const errors = fieldErrors(field.state.meta.errors);
                  const invalid = errors.length > 0;
                  const controlId = id("confirmTestMode");
                  return (
                    <Field orientation="horizontal" data-invalid={invalid || undefined}>
                      <Checkbox
                        id={controlId}
                        checked={field.state.value}
                        disabled={running}
                        aria-invalid={invalid || undefined}
                        aria-describedby={`${id("test-warning")}${invalid ? ` ${controlId}-error` : ""}`}
                        onCheckedChange={(checked) => field.handleChange(checked)}
                        onBlur={field.handleBlur}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={controlId}>
                          {m.stripe_import_test_confirm()}
                        </FieldLabel>
                        <FieldError id={`${controlId}-error`} role={undefined} errors={errors} />
                      </FieldContent>
                    </Field>
                  );
                }}
              </form.Field>
            )}

            {running && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {m.stripe_import_running_hint()}
              </p>
            )}

            {importError && (
              <div
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="flex flex-col items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive outline-none"
              >
                <p>{importError.text}</p>
                {importError.settingsLink && (
                  <Link
                    to="/settings"
                    className="font-medium underline underline-offset-4"
                    onClick={onCancel}
                  >
                    {m.stripe_import_to_settings()}
                  </Link>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" disabled={running} onClick={onCancel}>
                {m.common_cancel()}
              </Button>
              <Button
                type="submit"
                disabled={running}
                // Keeps the focus while the import runs.
                focusableWhenDisabled
                aria-busy={running || undefined}
              >
                {running ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {running ? m.stripe_import_running() : m.stripe_import_submit()}
              </Button>
            </DialogFooter>
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

/** The control's description and error ids plus the shared period description. */
function describedBy(control: ControlProps, extra: string): string {
  return [control["aria-describedby"], extra].filter(Boolean).join(" ");
}

function countsText(summary: StripeImportSummary): string {
  const created = String(summary.created);
  const skipped = String(summary.skipped);
  return summary.failed > 0
    ? m.stripe_import_done_counts_failed({ created, skipped, failed: String(summary.failed) })
    : m.stripe_import_done_counts({ created, skipped });
}

/** The result: counts, the entries not booked, a test-mode note and the way to the bookings. */
function ImportSummaryView({
  summary,
  onClose,
}: Readonly<{ summary: StripeImportSummary; onClose: () => void }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // The form (and the focused button) is gone: continue at the result.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby={headingId}>
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-base font-medium outline-none"
        >
          {m.stripe_import_done_title()}
        </h3>
        <p className="text-sm text-muted-foreground">
          {m.stripe_import_done_period({
            from: formatDate(summary.from),
            to: formatDate(summary.to),
          })}
        </p>
        <p className="text-lg font-medium tabular-nums">{countsText(summary)}</p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {m.stripe_import_done_details({
            feesCreated: String(summary.fees.created),
            feesSkipped: String(summary.fees.skipped),
            feesFailed: String(summary.fees.failed),
            refundsCreated: String(summary.refunds.created),
            refundsSkipped: String(summary.refunds.skipped),
            refundsFailed: String(summary.refunds.failed),
          })}
        </p>
        {summary.keyMode === "test" && summary.created > 0 && (
          <Warning>
            <p>{m.stripe_import_done_test_note()}</p>
          </Warning>
        )}
        {summary.failures.length > 0 && <FailureTable summary={summary} />}
      </section>
      <DialogFooter>
        {summary.created + summary.skipped > 0 && (
          <Link
            to="/bookings"
            search={importedBookingsSearch(summary)}
            className={buttonVariants({ variant: "outline" })}
            onClick={onClose}
          >
            {m.stripe_import_show_bookings()}
          </Link>
        )}
        <Button onClick={onClose}>{m.common_close()}</Button>
      </DialogFooter>
    </>
  );
}

function FailureTable({ summary }: Readonly<{ summary: StripeImportSummary }>) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-medium">{m.stripe_import_failures_heading()}</h4>
      <p className="text-sm text-muted-foreground">{m.stripe_import_failures_hint()}</p>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{m.stripe_import_failures_caption()}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{m.stripe_import_failures_column_kind()}</TableHead>
              <TableHead>{m.stripe_import_failures_column_id()}</TableHead>
              <TableHead>{m.stripe_import_failures_column_date()}</TableHead>
              <TableHead className="text-right">
                {m.stripe_import_failures_column_amount()}
              </TableHead>
              <TableHead>{m.stripe_import_failures_column_reason()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.failures.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{importKindLabel(row.kind)}</TableCell>
                <TableCell className="font-mono text-xs">{row.externalId}</TableCell>
                <TableCell className="tabular-nums">{row.date}</TableCell>
                <TableCell className="text-right tabular-nums">{row.amount}</TableCell>
                <TableCell className="whitespace-normal">{importFailureReason(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
