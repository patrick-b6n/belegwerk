/**
 * Stripe settings (#28): the restricted API key and the defaults of the
 * Stripe import (#30) – VAT rate and categories of imported application fees
 * and fee refunds. Pure parts (key validation and masking, validation and
 * suggestion of the defaults) live here; the service is in
 * `stripe-settings-service.ts`.
 *
 * Stored in the key/value `settings` table ({@link STRIPE_SETTING_KEYS}),
 * the key in plain text (#1). It never leaves the business layer towards the
 * UI: `StripeSettingsService.get()` returns it masked only; the import (#30)
 * reads it with `loadStripeImportSettings(repos)` in its own unit of work.
 */
import { isTaxOfficePayment } from "../euer";
import type { BookingType, Category, VatRate } from "../model";
import { isVatRate } from "../money";
import { isId, trimText } from "../validation";

/**
 * Keys in the `settings` table. `lastImportAt` is reserved for the import
 * (#30): the time of the last successful import (`toISOString()`), the
 * default start of the next import period (#31).
 */
export const STRIPE_SETTING_KEYS = {
  apiKey: "stripe.apiKey",
  defaultVatRate: "stripe.defaultVatRate",
  feeCategoryId: "stripe.feeCategoryId",
  refundCategoryId: "stripe.refundCategoryId",
  lastImportAt: "stripe.lastImportAt",
} as const;

/** Live or test mode of a key (from its prefix `rk_live_` / `rk_test_`). */
export type StripeKeyMode = "live" | "test";

/** What the UI may know about the stored key – never the key itself. */
export interface StripeApiKeyInfo {
  /** Prefix and the last four characters, e.g. `rk_live_…AbCd`. */
  readonly masked: string;
  readonly mode: StripeKeyMode;
}

/**
 * Why a key is refused:
 * - `required`: empty (after trimming).
 * - `secretKeyNotAllowed`: a secret key (`sk_live_…`/`sk_test_…`) – it
 *   grants full access to the Stripe account; the app only stores
 *   restricted read-only keys.
 * - `publishableKeyNotAllowed`: a publishable key (`pk_…`) cannot read
 *   application fees.
 * - `invalidKey`: no restricted key `rk_live_…`/`rk_test_…` with 10–247
 *   letters or digits after the prefix (Stripe keys contain no other
 *   characters).
 */
export type StripeApiKeyErrorCode =
  | "required"
  | "secretKeyNotAllowed"
  | "publishableKeyNotAllowed"
  | "invalidKey";

/** Total length limit of a key (prefix 8 + 247). */
export const STRIPE_API_KEY_MAX_LENGTH = 255;

const RESTRICTED_KEY = /^rk_(live|test)_[A-Za-z0-9]{10,247}$/;
const SECRET_KEY = /^sk_(live|test)_/;
const PUBLISHABLE_KEY = /^pk_(live|test)_/;

export type ValidateStripeApiKeyResult =
  | { readonly ok: true; readonly apiKey: string; readonly mode: StripeKeyMode }
  | { readonly ok: false; readonly code: StripeApiKeyErrorCode };

/**
 * Checks a key as entered: trimmed (also invisible characters at the ends,
 * e.g. from copying), then it must be a restricted key. Shared by the
 * service and the form's client check. Non-strings count as empty.
 */
export function validateStripeApiKey(input: unknown): ValidateStripeApiKeyResult {
  const apiKey = typeof input === "string" ? trimText(input) : "";
  if (apiKey === "") return { ok: false, code: "required" };
  if (SECRET_KEY.test(apiKey)) return { ok: false, code: "secretKeyNotAllowed" };
  if (PUBLISHABLE_KEY.test(apiKey)) return { ok: false, code: "publishableKeyNotAllowed" };
  const match = RESTRICTED_KEY.exec(apiKey);
  if (!match) return { ok: false, code: "invalidKey" };
  return { ok: true, apiKey, mode: match[1] === "live" ? "live" : "test" };
}

/**
 * The masked form of a stored key: prefix and the last four characters
 * (`rk_live_…AbCd`). A stored value that is no valid key (edited database)
 * is masked completely (`…` plus at most the last four characters, mode from
 * the prefix if recognizable, else `live` – the cautious assumption).
 */
export function maskStripeApiKey(apiKey: string): StripeApiKeyInfo {
  const match = /^(rk_(live|test)_)/.exec(apiKey);
  const prefix = match?.[1] ?? "";
  const rest = apiKey.slice(prefix.length);
  const tail = rest.length > 8 ? rest.slice(-4) : "";
  return { masked: `${prefix}…${tail}`, mode: match?.[2] === "test" ? "test" : "live" };
}

/** The defaults of imported bookings, as entered (`setDefaults`). */
export interface StripeDefaultsInput {
  /**
   * VAT rate of imported fees and refunds in **regularly taxed** years. In a
   * small business year the import books without a rate regardless (#30).
   */
  readonly defaultVatRate: VatRate;
  /** Income category of application fees. */
  readonly feeCategoryId: number;
  /** Expense category with "reduces income" (Erlösminderung) of fee refunds. */
  readonly refundCategoryId: number;
}

/** Stored defaults; a field is `null` while it was never saved (or is unreadable). */
export interface StoredStripeDefaults {
  readonly defaultVatRate: VatRate | null;
  readonly feeCategoryId: number | null;
  readonly refundCategoryId: number | null;
}

/**
 * Error codes per field of the defaults:
 * - `required`: missing (not a VAT rate value / not an id, e.g. `NaN`).
 * - `invalidVatRate`: a value that is no VAT rate.
 * - `categoryNotFound`, `categoryArchived`: the category does not exist or
 *   is archived (not for new bookings).
 * - `categoryTypeMismatch`: fee category not an income category, refund
 *   category not an expense category.
 * - `categoryNotRevenueReduction`: refund category without "mindert
 *   Einnahmen" – a refund of fees reduces the fee income (#1).
 * - `categoryTaxOffice`: fee category on a tax office position (USt-Erstattung)
 *   – fees are revenue, not refunds from the tax office.
 */
export interface StripeDefaultsFieldErrorCodes {
  readonly defaultVatRate: "required" | "invalidVatRate";
  readonly feeCategoryId: StripeCategoryErrorCode | "categoryTaxOffice";
  readonly refundCategoryId: StripeCategoryErrorCode | "categoryNotRevenueReduction";
}

export type StripeCategoryErrorCode =
  | "required"
  | "categoryNotFound"
  | "categoryArchived"
  | "categoryTypeMismatch";

export type StripeDefaultsField = keyof StripeDefaultsFieldErrorCodes;

export type StripeDefaultsFieldError = {
  readonly [F in StripeDefaultsField]: {
    readonly field: F;
    readonly code: StripeDefaultsFieldErrorCodes[F];
  };
}[StripeDefaultsField];

/**
 * Validates defaults against `categories` (all, incl. archived). All field
 * errors, at most one per field, in the order VAT rate, fee category, refund
 * category; `[]` = valid. Runtime guards: values of the wrong type count as
 * missing. Used by the service, by the import (stored defaults may have
 * become invalid, e.g. an archived category) and by the settings form.
 */
export function validateStripeDefaults(
  input: Partial<Record<keyof StripeDefaultsInput, unknown>>,
  categories: readonly Category[],
): StripeDefaultsFieldError[] {
  const errors: StripeDefaultsFieldError[] = [];
  const { defaultVatRate, feeCategoryId, refundCategoryId } = input;
  if (!isVatRate(defaultVatRate)) {
    const missing =
      defaultVatRate === null || defaultVatRate === undefined || defaultVatRate === "";
    errors.push({ field: "defaultVatRate", code: missing ? "required" : "invalidVatRate" });
  }
  const fee = checkCategory(feeCategoryId, "income", categories);
  if (fee) {
    errors.push({ field: "feeCategoryId", code: fee });
  } else if (isTaxOfficeCategory(feeCategoryId, categories)) {
    errors.push({ field: "feeCategoryId", code: "categoryTaxOffice" });
  }
  const refund = checkCategory(refundCategoryId, "expense", categories);
  if (refund) {
    errors.push({ field: "refundCategoryId", code: refund });
  } else if (!categories.find((c) => c.id === refundCategoryId)?.reducesIncome) {
    errors.push({ field: "refundCategoryId", code: "categoryNotRevenueReduction" });
  }
  return errors;
}

/** Whether category `id` books payments to or refunds from the tax office (`isTaxOfficePayment`). */
export function isTaxOfficeCategory(id: unknown, categories: readonly Category[]): boolean {
  const category = categories.find((c) => c.id === id);
  return category !== undefined && isTaxOfficePayment(category.euerPosition);
}

function checkCategory(
  id: unknown,
  type: BookingType,
  categories: readonly Category[],
): StripeCategoryErrorCode | undefined {
  if (typeof id !== "number" || !isId(id)) return "required";
  const category = categories.find((c) => c.id === id);
  if (!category) return "categoryNotFound";
  if (category.archived) return "categoryArchived";
  if (category.type !== type) return "categoryTypeMismatch";
  return undefined;
}

/** What the form pre-selects while no defaults are stored; never saved by itself. */
export interface SuggestedStripeDefaults {
  readonly defaultVatRate: VatRate;
  readonly feeCategoryId: number | null;
  readonly refundCategoryId: number | null;
}

/** The position of regular (VAT-able) turnover – application fees are such revenue. */
const TURNOVER_POSITION = "BETRIEBSEINNAHMEN_UST_PFLICHTIG";

/**
 * Suggested defaults, found by position and flag (never by name, as the
 * EÜR): fees → the first (lowest id) unarchived income category on the
 * VAT-able turnover position (seeded: „Umsatzerlöse“); refunds → the first
 * unarchived expense category that reduces income on that position,
 * preferring the system category („Erlösminderung / Rückerstattung“), else
 * on any position. VAT rate 19 % – a German platform's fee for a domestic
 * connected account; the user must confirm it (EU/abroad: reverse charge or
 * 0 %). `null` if no category fits.
 */
export function suggestStripeDefaults(categories: readonly Category[]): SuggestedStripeDefaults {
  const active = categories.filter((c) => !c.archived);
  active.sort((a, b) => a.id - b.id);
  const fee = active.find((c) => c.type === "income" && c.euerPosition === TURNOVER_POSITION);
  const reductions = active.filter((c) => c.type === "expense" && c.reducesIncome);
  const refund =
    reductions.find((c) => c.isSystem && c.euerPosition === TURNOVER_POSITION) ??
    reductions.find((c) => c.euerPosition === TURNOVER_POSITION) ??
    reductions[0];
  return {
    defaultVatRate: "19",
    feeCategoryId: fee?.id ?? null,
    refundCategoryId: refund?.id ?? null,
  };
}

/** A stored VAT rate, or `null` if absent or not a rate. */
export function parseStoredVatRate(value: string | undefined): VatRate | null {
  return isVatRate(value) ? value : null;
}

/** A stored category id (decimal digits), or `null` if absent or unreadable. */
export function parseStoredId(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return null;
  const id = Number(value);
  return isId(id) ? id : null;
}
