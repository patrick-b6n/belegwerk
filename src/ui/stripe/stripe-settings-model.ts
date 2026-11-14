/**
 * Pure logic of the "Stripe" settings (#28): initial values of the defaults
 * form (stored, else suggested), the category options and the conversion of
 * the form values. No React, so it is unit-tested in Node.
 *
 * The business layer is the source of truth: the form checks only what it
 * can tell itself (empty selects); `setDefaults` validates everything.
 */
import type { Category, VatRate } from "@/business/model";
import {
  type StoredStripeDefaults,
  type StripeDefaultsFieldError,
  type StripeDefaultsInput,
  isTaxOfficeCategory,
  suggestStripeDefaults,
  validateStripeDefaults,
} from "@/business/stripe";

/** Values of the defaults form; `""` = nothing selected. */
export interface StripeDefaultsFormValues {
  readonly defaultVatRate: VatRate | "";
  readonly feeCategoryId: string;
  readonly refundCategoryId: string;
}

/** The fields of the defaults form, in display order. */
export const STRIPE_DEFAULTS_FIELDS = [
  "defaultVatRate",
  "feeCategoryId",
  "refundCategoryId",
] as const;

/** Whether nothing of the defaults was saved yet (the form shows suggestions). */
export function defaultsUnsaved(stored: StoredStripeDefaults): boolean {
  return STRIPE_DEFAULTS_FIELDS.some((field) => stored[field] === null);
}

/**
 * The form's initial values: each stored value, else the suggestion
 * (`suggestStripeDefaults`). A stored category that no longer exists starts
 * empty (the select could not show it).
 */
export function defaultsFormValues(
  stored: StoredStripeDefaults,
  categories: readonly Category[],
): StripeDefaultsFormValues {
  const suggested = suggestStripeDefaults(categories);
  const id = (value: number | null) =>
    value !== null && categories.some((c) => c.id === value) ? String(value) : "";
  return {
    defaultVatRate: stored.defaultVatRate ?? suggested.defaultVatRate,
    feeCategoryId: id(stored.feeCategoryId ?? suggested.feeCategoryId),
    refundCategoryId: id(stored.refundCategoryId ?? suggested.refundCategoryId),
  };
}

/**
 * Problems of the **stored** defaults with the current categories (e.g. a
 * category archived since), so the page can ask to fix them. Unsaved fields
 * are no problem here (the form shows suggestions instead).
 */
export function storedDefaultsProblems(
  stored: StoredStripeDefaults,
  categories: readonly Category[],
): StripeDefaultsFieldError[] {
  return validateStripeDefaults(stored, categories).filter((error) => stored[error.field] !== null);
}

/**
 * Categories for application fees: income categories without archived ones
 * and without the tax office's (USt-Erstattung) – except the `keep` ids (the
 * stored and the selected category), which stay visible (marked) so the
 * select can show a stored category archived since, also while another one
 * is chosen. Sorted by name.
 */
export function feeCategoryOptions(
  categories: readonly Category[],
  keep: readonly (number | null)[],
): Category[] {
  return options(
    categories,
    keep,
    (c) => c.type === "income" && !isTaxOfficeCategory(c.id, categories),
  );
}

/** Categories for fee refunds: expense categories that reduce income (Erlösminderung). */
export function refundCategoryOptions(
  categories: readonly Category[],
  keep: readonly (number | null)[],
): Category[] {
  return options(categories, keep, (c) => c.type === "expense" && c.reducesIncome);
}

function options(
  categories: readonly Category[],
  keep: readonly (number | null)[],
  fits: (category: Category) => boolean,
): Category[] {
  const result = categories.filter((c) => fits(c) && (!c.archived || keep.includes(c.id)));
  result.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return result;
}

/** A select value as id (`null` if empty). */
export function selectedId(value: string): number | null {
  return value === "" ? null : Number(value);
}

/** The form values as service input; an empty select gives `NaN` (`required`). */
export function toStripeDefaultsInput(values: StripeDefaultsFormValues): StripeDefaultsInput {
  return {
    // An empty select reaches the service as "", which it reports as `required`.
    defaultVatRate: values.defaultVatRate as VatRate,
    feeCategoryId: values.feeCategoryId === "" ? Number.NaN : Number(values.feeCategoryId),
    refundCategoryId: values.refundCategoryId === "" ? Number.NaN : Number(values.refundCategoryId),
  };
}
