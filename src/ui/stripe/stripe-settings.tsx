import { useForm } from "@tanstack/react-form";
import { AlertTriangle } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { Category, VatRate } from "@/business/model";
import {
  type StoredStripeDefaults,
  type StripeApiKeyInfo,
  validateStripeApiKey,
} from "@/business/stripe";
import { m } from "@/paraglide/messages.js";
import { VAT_RATES } from "@/ui/bookings/booking-form-model";
import { VAT_RATE_LABELS } from "@/ui/bookings/booking-messages";
import { useCategoryList } from "@/ui/categories/category-queries";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { toast } from "@/ui/components/ui/toast";
import { focusFirstInvalid, FormField } from "@/ui/forms/form-field";
import { revalidateKeepingServerErrorsOnBlur } from "@/ui/forms/validation-logic";

import {
  apiKeyErrorMessage,
  defaultsErrorMessage,
  defaultsFieldLabel,
  keyModeLabel,
} from "./stripe-messages";
import {
  defaultsFormValues,
  defaultsUnsaved,
  feeCategoryOptions,
  refundCategoryOptions,
  selectedId,
  storedDefaultsProblems,
  type StripeDefaultsFormValues,
  toStripeDefaultsInput,
} from "./stripe-settings-model";
import { useStripeSettingsMutations } from "./stripe-mutations";
import { useStripeSettings } from "./stripe-queries";

/**
 * The "Stripe" section of the settings page (#28): the restricted API key
 * (masked; save, change, remove) with the hint about the required
 * permission, and the defaults of imported bookings (VAT rate, category of
 * fees and of fee refunds).
 */
export function StripeSettings() {
  const settings = useStripeSettings();
  const categories = useCategoryList();

  if (settings.isPending || categories.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.stripe_loading()}
      </p>
    );
  }
  if (settings.error || categories.error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.stripe_load_error()}</p>
        <Button
          variant="outline"
          onClick={() => void Promise.all([settings.refetch(), categories.refetch()])}
        >
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  const { apiKey, defaults } = settings.data;
  return (
    <div className="flex flex-col gap-8">
      <ApiKeyPanel apiKey={apiKey} />
      <DefaultsForm stored={defaults} categories={categories.data} />
    </div>
  );
}

function SubHeading({ id, children }: Readonly<{ id: string; children: string }>) {
  return (
    <h3 id={id} className="font-heading text-base font-medium">
      {children}
    </h3>
  );
}

/**
 * The key: without one the input form; with one its masked form, mode and
 * "Ändern" (opens the input form) / "Entfernen" (asks first).
 */
function ApiKeyPanel({ apiKey }: Readonly<{ apiKey: StripeApiKeyInfo | null }>) {
  const headingId = useId();
  const groupId = useId();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);

  return (
    <div id={groupId} role="group" aria-labelledby={headingId} className="flex flex-col gap-3">
      <SubHeading id={headingId}>{m.stripe_key_heading()}</SubHeading>
      <div className="flex max-w-3xl flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm">
        <p>{m.stripe_key_permission_hint()}</p>
        <p className="text-muted-foreground">{m.stripe_key_create_hint()}</p>
        <p className="text-muted-foreground">{m.stripe_key_storage_hint()}</p>
      </div>
      {apiKey ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{m.stripe_key_stored_label()}</span>
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm">
            {apiKey.masked}
          </code>
          <span
            className={
              apiKey.mode === "live"
                ? "rounded-sm bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "rounded-sm bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }
          >
            {keyModeLabel(apiKey.mode)}
          </span>
          {!editing && (
            <span className="flex gap-2">
              <Button ref={changeRef} variant="outline" onClick={() => setEditing(true)}>
                {m.stripe_key_change()}
              </Button>
              <Button variant="destructive" onClick={() => setConfirmRemove(true)}>
                {m.stripe_key_remove()}
              </Button>
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{m.stripe_key_none()}</p>
      )}
      {(!apiKey || editing) && (
        <ApiKeyForm
          replacing={apiKey !== null}
          onDone={() => {
            setEditing(false);
            requestAnimationFrame(() => changeRef.current?.focus());
          }}
        />
      )}
      <RemoveKeyDialog
        open={confirmRemove}
        onClose={(removed) => {
          setConfirmRemove(false);
          // The buttons are gone after removing: continue at the key input.
          if (removed) {
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>(`#${CSS.escape(groupId)} input`)?.focus(),
            );
          }
        }}
      />
    </div>
  );
}

/**
 * Input of a new key: a password field (not shown, no autocomplete or
 * spellcheck), checked like the service (`validateStripeApiKey`) on submit
 * and then on every change; the service's code at the field. The value is
 * cleared after saving so the key does not stay in the form's state.
 */
function ApiKeyForm({ replacing, onDone }: Readonly<{ replacing: boolean; onDone: () => void }>) {
  const { saveApiKey } = useStripeSettingsMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  const form = useForm({
    defaultValues: { apiKey: "" },
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await saveApiKey(value.apiKey);
        if (result.ok) {
          toast.add({ title: m.stripe_key_saved_toast(), type: "success" });
          formApi.reset({ apiKey: "" });
          onDone();
          return;
        }
        const message = apiKeyErrorMessage(result.errors[0].code);
        formApi.setFieldMeta("apiKey", (meta) => ({
          ...meta,
          errorMap: { ...meta.errorMap, onServer: message },
          errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
        }));
        focusFirstInvalid(formRef.current);
      } catch {
        // No details: the error must not carry the key into the console.
        console.error("Saving the Stripe API key failed");
        toast.add({ title: m.stripe_key_save_error(), type: "error" });
      }
    },
  });
  const label = replacing ? m.stripe_key_input_new_label() : m.stripe_key_input_label();

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={label}
      className="flex flex-wrap items-start gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="apiKey"
        validators={{
          onDynamic: ({ value }) => {
            const result = validateStripeApiKey(value);
            return result.ok ? undefined : apiKeyErrorMessage(result.code);
          },
        }}
      >
        {(field) => (
          <FormField
            id={`${id}-key`}
            label={label}
            errors={field.state.meta.errors}
            className="w-full max-w-2xl"
          >
            {(control) => (
              <div className="flex flex-wrap gap-2">
                <Input
                  {...control}
                  type="password"
                  required
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={m.stripe_key_input_placeholder()}
                  className="min-w-0 flex-1 font-mono"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? m.stripe_key_saving() : m.stripe_key_save()}
                    </Button>
                  )}
                </form.Subscribe>
                {replacing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      form.reset({ apiKey: "" });
                      onDone();
                    }}
                  >
                    {m.common_cancel()}
                  </Button>
                )}
              </div>
            )}
          </FormField>
        )}
      </form.Field>
    </form>
  );
}

/** Asks before removing the key; the safe choice ("Abbrechen") gets the initial focus. */
function RemoveKeyDialog({
  open,
  onClose,
}: Readonly<{ open: boolean; onClose: (removed: boolean) => void }>) {
  const { deleteApiKey } = useStripeSettingsMutations();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = async () => {
    try {
      await deleteApiKey.mutateAsync();
      toast.add({ title: m.stripe_key_removed_toast(), type: "success" });
      onClose(true);
    } catch (error) {
      console.error("Removing the Stripe API key failed", error);
      toast.add({ title: m.stripe_key_remove_error(), type: "error" });
      onClose(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && !deleteApiKey.isPending && onClose(false)}
    >
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.stripe_key_remove_title()}</AlertDialogTitle>
          <AlertDialogDescription>{m.stripe_key_remove_description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={deleteApiKey.isPending}>
            {m.common_cancel()}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteApiKey.isPending}
            onClick={() => void confirm()}
          >
            {deleteApiKey.isPending ? m.stripe_key_removing() : m.stripe_key_remove_confirm()}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Select items of categories; archived ones (a stored choice) are marked. */
function categoryItems(options: readonly Category[]) {
  return options.map((category) => ({
    value: String(category.id),
    label: category.archived
      ? m.stripe_defaults_category_archived({ name: category.name })
      : category.name,
  }));
}

/** Client check of a select of the defaults form: something must be chosen. */
function requiredMessage(field: keyof StripeDefaultsFormValues, value: string) {
  if (value !== "") return undefined;
  return defaultsErrorMessage({ field, code: "required" });
}

/**
 * The defaults of imported bookings. Starts with the stored values, else
 * with suggestions (seeded „Umsatzerlöse“ / „Erlösminderung / Rückerstattung“,
 * 19 %) and says so; nothing is saved until the user saves. Stored values
 * that became invalid (e.g. an archived category) are listed above the form.
 */
function DefaultsForm({
  stored,
  categories,
}: Readonly<{ stored: StoredStripeDefaults; categories: readonly Category[] }>) {
  const { setDefaults } = useStripeSettingsMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const headingId = `${id}-heading`;
  const unsaved = defaultsUnsaved(stored);
  const problems = storedDefaultsProblems(stored, categories);

  const form = useForm({
    defaultValues: defaultsFormValues(stored, categories),
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
    onSubmitInvalid: () => focusFirstInvalid(formRef.current),
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await setDefaults.mutateAsync(toStripeDefaultsInput(value));
        if (result.ok) {
          toast.add({ title: m.stripe_defaults_saved_toast(), type: "success" });
          return;
        }
        for (const error of result.errors) {
          formApi.setFieldMeta(error.field, (meta) => ({
            ...meta,
            errorMap: { ...meta.errorMap, onServer: defaultsErrorMessage(error) },
            errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
          }));
        }
        focusFirstInvalid(formRef.current);
      } catch (error) {
        console.error("Saving the Stripe defaults failed", error);
        toast.add({ title: m.stripe_defaults_save_error(), type: "error" });
      }
    },
  });

  return (
    <form
      ref={formRef}
      noValidate
      aria-labelledby={headingId}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <SubHeading id={headingId}>{m.stripe_defaults_heading()}</SubHeading>
      {unsaved && <p className="text-sm text-muted-foreground">{m.stripe_defaults_unsaved()}</p>}
      {problems.length > 0 && (
        <div className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p>{m.stripe_defaults_problems()}</p>
            <ul className="list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem.field}>
                  {m.stripe_defaults_problem({
                    field: defaultsFieldLabel(problem.field),
                    message: defaultsErrorMessage(problem),
                  })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <form.Field
        name="defaultVatRate"
        validators={{ onDynamic: ({ value }) => requiredMessage("defaultVatRate", value) }}
      >
        {(field) => (
          <FormField
            id={`${id}-vat`}
            label={m.stripe_defaults_vat_rate_label()}
            description={m.stripe_defaults_vat_rate_description()}
            errors={field.state.meta.errors}
            className="max-w-xl"
          >
            {(control) => (
              <Select<VatRate>
                items={VAT_RATES.map((rate) => ({ value: rate, label: VAT_RATE_LABELS[rate]() }))}
                value={field.state.value === "" ? null : field.state.value}
                onValueChange={(value) => field.handleChange(value ?? "")}
              >
                <SelectTrigger {...control} onBlur={field.handleBlur} className="w-full sm:w-44">
                  <SelectValue placeholder={m.stripe_defaults_vat_rate_placeholder()} />
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
        )}
      </form.Field>

      {(["feeCategoryId", "refundCategoryId"] as const).map((name) => (
        <form.Field
          key={name}
          name={name}
          validators={{ onDynamic: ({ value }) => requiredMessage(name, value) }}
        >
          {(field) => {
            const fee = name === "feeCategoryId";
            const keep = [stored[name], selectedId(field.state.value)];
            const options = fee
              ? feeCategoryOptions(categories, keep)
              : refundCategoryOptions(categories, keep);
            const items = categoryItems(options);
            return (
              <FormField
                id={`${id}-${name}`}
                label={
                  fee
                    ? m.stripe_defaults_fee_category_label()
                    : m.stripe_defaults_refund_category_label()
                }
                description={
                  options.length === 0
                    ? m.stripe_defaults_category_none()
                    : fee
                      ? m.stripe_defaults_fee_category_description()
                      : m.stripe_defaults_refund_category_description()
                }
                errors={field.state.meta.errors}
                className="max-w-xl"
              >
                {(control) => (
                  <Select<string>
                    items={items}
                    value={field.state.value === "" ? null : field.state.value}
                    onValueChange={(value) => field.handleChange(value ?? "")}
                  >
                    <SelectTrigger
                      {...control}
                      onBlur={field.handleBlur}
                      className="w-full sm:w-96"
                    >
                      <SelectValue placeholder={m.stripe_defaults_category_placeholder()} />
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
      ))}

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? m.stripe_defaults_saving() : m.stripe_defaults_save()}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
