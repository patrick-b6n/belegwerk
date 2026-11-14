/**
 * Pure logic of the booking form (#18): form values, conversion to the
 * service input, client-side checks, the live amount preview and the
 * category options. No React, so it is unit-tested in Node.
 *
 * The business layer is the source of truth: the client-side checks only
 * cover what the form can tell without the database (required fields, the
 * amount text) so obvious mistakes show without a round trip; everything
 * else – and these rules again – is checked by `BookingService`.
 */
import type { BookingField, BookingFieldError, BookingFormInput } from "@/business/bookings";
import type { CategoryWithUsage } from "@/business/categories";
import { isTaxOfficePayment } from "@/business/euer";
import { parseAmount, parseIsoDate, type ParseAmountError } from "@/business/format";
import { calculateBookingAmounts } from "@/business/money";
import type { Booking, BookingType, VatRate } from "@/business/model";
import { trimText } from "@/business/validation";

/** The form's values: what the inputs hold (strings), not yet converted. */
export interface BookingFormValues {
  /** `YYYY-MM-DD` from the date input; `""` while empty or incomplete. */
  readonly date: string;
  readonly type: BookingType;
  /** Gross amount as typed (de-DE, decimal comma). */
  readonly amount: string;
  /** `""` = none chosen. Ignored (sent as `null`) in small business years. */
  readonly vatRate: VatRate | "";
  /** Category id as string; `""` = none chosen. */
  readonly categoryId: string;
  readonly description: string;
  readonly counterparty: string;
  readonly reference: string;
  readonly note: string;
}

export type BookingFormField = keyof BookingFormValues;

/** VAT rates in the order the form offers them. */
export const VAT_RATES: readonly VatRate[] = ["19", "7", "0", "reverse_charge"];

/** Default VAT rate of a new booking (the standard rate). */
const DEFAULT_VAT_RATE: VatRate = "19";

/** Today's local calendar date as `YYYY-MM-DD` (the date a new booking starts with). */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

const euroFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/**
 * Integer cents as the amount input shows them: `123456` → `"1.234,56"`
 * (without `€`; `parseAmount` reads it back to the same cents).
 */
export function formatAmountInput(cents: number): string {
  const rest = cents % 100;
  // cents − rest is a multiple of 100: exact division.
  const euros = (cents - rest) / 100;
  const restDigits = String(rest).padStart(2, "0");
  return `${euroFormat.format(euros)},${restDigits}`;
}

/** Values of a new booking: today, expense, standard rate, everything else empty. */
export function newBookingFormValues(today: string): BookingFormValues {
  return {
    date: today,
    type: "expense",
    amount: "",
    vatRate: DEFAULT_VAT_RATE,
    categoryId: "",
    description: "",
    counterparty: "",
    reference: "",
    note: "",
  };
}

/** Values of an existing booking. A booking without VAT rate starts with none chosen. */
export function bookingFormValues(booking: Booking): BookingFormValues {
  return {
    date: booking.date,
    type: booking.type,
    amount: formatAmountInput(booking.grossCents),
    vatRate: booking.vatRate ?? "",
    categoryId: String(booking.categoryId),
    description: booking.description,
    counterparty: booking.counterparty,
    reference: booking.reference ?? "",
    note: booking.note ?? "",
  };
}

/** The tax year of the form's date; `undefined` while the date is empty or invalid. */
export function taxYearOf(date: string): number | undefined {
  return parseIsoDate(date)?.year;
}

/**
 * What the form submits to `BookingService.create`/`update`. In a small
 * business year the VAT rate is `null` (the field is hidden). `source` and
 * `externalId` are omitted: `create` uses the defaults, `update` keeps the
 * booking's values (docs/architecture.md, Buchungs-Service).
 *
 * Invalid values are passed on as the service expects them (an unparsable
 * amount as `NaN`, no category as `NaN`), so the service reports them, too.
 */
export function toBookingFormInput(
  values: BookingFormValues,
  smallBusiness: boolean,
): BookingFormInput {
  const amount = parseAmount(values.amount);
  return {
    date: values.date,
    type: values.type,
    grossCents: amount.ok ? amount.cents : Number.NaN,
    vatRate: smallBusiness || values.vatRate === "" ? null : values.vatRate,
    categoryId: values.categoryId === "" ? Number.NaN : Number(values.categoryId),
    description: values.description,
    counterparty: values.counterparty,
    reference: values.reference,
    note: values.note,
  };
}

/**
 * A client-side error of the amount input: the `parseAmount` codes, plus the
 * service's `amountNotPositive` for `"0"`.
 */
export type AmountInputError = ParseAmountError | "amountNotPositive";

/** Errors the form detects itself, in the service's terms where possible. */
export type ClientFieldError =
  | { readonly field: "date"; readonly code: "required" }
  | { readonly field: "amount"; readonly code: AmountInputError }
  | { readonly field: "vatRate"; readonly code: "vatRateRequired" }
  | { readonly field: "categoryId"; readonly code: "required" }
  | { readonly field: "description"; readonly code: "required" }
  | { readonly field: "counterparty"; readonly code: "required" };

/** Client-side check of the date: empty (also: incomplete in the date input) → required. */
export function checkDate(date: string): ClientFieldError | undefined {
  return date === "" ? { field: "date", code: "required" } : undefined;
}

/** Client-side check of the amount text: must parse and be greater than 0. */
export function checkAmount(amount: string): ClientFieldError | undefined {
  const parsed = parseAmount(amount);
  if (!parsed.ok) return { field: "amount", code: parsed.error };
  if (parsed.cents === 0) return { field: "amount", code: "amountNotPositive" };
  return undefined;
}

/** Client-side check of the VAT rate: required unless the year is a small business year. */
export function checkVatRate(
  vatRate: VatRate | "",
  smallBusiness: boolean,
): ClientFieldError | undefined {
  return !smallBusiness && vatRate === ""
    ? { field: "vatRate", code: "vatRateRequired" }
    : undefined;
}

export function checkCategory(categoryId: string): ClientFieldError | undefined {
  return categoryId === "" ? { field: "categoryId", code: "required" } : undefined;
}

export function checkRequiredText(
  field: "description" | "counterparty",
  value: string,
): ClientFieldError | undefined {
  return trimText(value) === "" ? { field, code: "required" } : undefined;
}

/** The form field that shows a service field's errors; `undefined` = not in the form. */
const FORM_FIELD: Readonly<Record<BookingField, BookingFormField | undefined>> = {
  date: "date",
  type: "type",
  grossCents: "amount",
  vatRate: "vatRate",
  categoryId: "categoryId",
  description: "description",
  counterparty: "counterparty",
  reference: "reference",
  note: "note",
  // Not editable in the form (kept by the service); shown above the form.
  source: undefined,
  externalId: undefined,
};

export function formFieldOf(field: BookingField): BookingFormField | undefined {
  return FORM_FIELD[field];
}

/** Service errors sorted by where the form shows them. */
export function splitServiceErrors(errors: readonly BookingFieldError[]): {
  readonly byField: ReadonlyMap<BookingFormField, BookingFieldError>;
  readonly other: readonly BookingFieldError[];
} {
  const byField = new Map<BookingFormField, BookingFieldError>();
  const other: BookingFieldError[] = [];
  for (const error of errors) {
    const field = formFieldOf(error.field);
    if (field === undefined) other.push(error);
    else byField.set(field, error);
  }
  return { byField, other };
}

/** Net and VAT of the live preview. */
export interface AmountPreview {
  readonly grossCents: number;
  readonly netCents: number;
  readonly vatCents: number;
}

/**
 * Net/VAT the service would compute (`calculateBookingAmounts`) for the
 * typed amount and rate in the year's tax status; `undefined` while the
 * amount is invalid or (regularly taxed) no rate is chosen.
 */
export function previewAmounts(
  amount: string,
  vatRate: VatRate | "",
  smallBusiness: boolean,
): AmountPreview | undefined {
  if (checkAmount(amount)) return undefined;
  const parsed = parseAmount(amount);
  if (!parsed.ok) return undefined;
  const rate = smallBusiness || vatRate === "" ? null : vatRate;
  const result = calculateBookingAmounts(parsed.cents, rate, smallBusiness);
  if (!result.ok) return undefined;
  return { grossCents: result.grossCents, netCents: result.netCents, vatCents: result.vatCents };
}

/**
 * The categories the form offers for `type`: those of that type that are
 * not archived – plus the categories in `keep` even if archived:
 *
 * - the edited booking's current category, since a booking may keep its
 *   archived category (docs/architecture.md, Buchungs-Service);
 * - the selected one: if it is archived while the form is open, it stays
 *   visible with its "archived" mark and the service's error
 *   (`categoryArchived`) instead of silently vanishing from the select.
 *
 * Sorted by name (de).
 */
export function categoryOptions(
  categories: readonly CategoryWithUsage[],
  type: BookingType,
  keep: readonly (number | undefined)[] = [],
): CategoryWithUsage[] {
  const options = categories.filter(
    (category) => category.type === type && (!category.archived || keep.includes(category.id)),
  );
  options.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return options;
}

/**
 * The category after the type changed: kept if it is offered for the new
 * type, otherwise cleared (`""`).
 */
export function categoryAfterTypeChange(
  categoryId: string,
  options: readonly CategoryWithUsage[],
): string {
  return options.some((category) => String(category.id) === categoryId) ? categoryId : "";
}

/**
 * Whether the selected category books VAT paid to or refunded by the tax
 * office (`UST_AN_FA`, `UST_ERSTATTUNG`): such payments contain no VAT, the
 * EÜR counts their full amount (#25). The form then suggests rate 0.
 */
export function isTaxOfficeCategory(
  categoryId: string,
  categories: readonly CategoryWithUsage[],
): boolean {
  const category = categories.find((candidate) => String(candidate.id) === categoryId);
  return category !== undefined && isTaxOfficePayment(category.euerPosition);
}

/**
 * The VAT rate after choosing a category: rate 0 for a tax-office category
 * (the user can still change it – the service accepts any rate), otherwise
 * unchanged.
 */
export function vatRateAfterCategoryChange(
  categoryId: string,
  categories: readonly CategoryWithUsage[],
  vatRate: VatRate | "",
): VatRate | "" {
  return isTaxOfficeCategory(categoryId, categories) ? "0" : vatRate;
}

/** Suggestions shown at once while typing (the service sends more to filter from). */
export const SHOWN_TEXT_SUGGESTIONS = 50;

/** A suggestion with its comparison key (see {@link prepareTextSuggestions}). */
export interface PreparedTextSuggestion {
  readonly text: string;
  /** NFC, lower case (de). */
  readonly key: string;
}

/**
 * Computes the comparison keys of the suggestions once per list (not on
 * every keystroke) for {@link filterTextSuggestions}.
 */
export function prepareTextSuggestions(suggestions: readonly string[]): PreparedTextSuggestion[] {
  return suggestions.map((text) => ({ text, key: text.normalize("NFC").toLocaleLowerCase("de") }));
}

/**
 * The suggestions (`BookingService.suggestTexts`, most relevant first) that
 * match what is typed in description or counterparty: substring match
 * ignoring case, also for umlauts and decomposed input ("mü" finds
 * "Müller", "MÜ" too). Suggestions that start with the input, or have a
 * word starting with it, come before other matches; otherwise the order
 * stays. A suggestion equal to the input is left out (nothing to complete).
 * At most `max`; a blank input matches all.
 */
export function filterTextSuggestions(
  suggestions: readonly PreparedTextSuggestion[],
  input: string,
  max: number = SHOWN_TEXT_SUGGESTIONS,
): string[] {
  const typed = trimText(input).normalize("NFC");
  const query = typed.toLocaleLowerCase("de");
  const starts: string[] = [];
  const contains: string[] = [];
  for (const { text, key } of suggestions) {
    if (text === typed) continue;
    const index = query === "" ? 0 : key.indexOf(query);
    if (index < 0) continue;
    const wordStart = index === 0 || key.slice(0, index).search(/[\p{L}\p{N}]$/u) < 0;
    (wordStart ? starts : contains).push(text);
    if (starts.length >= max) break;
  }
  return [...starts, ...contains].slice(0, max);
}
