/**
 * Pure logic of the Stripe import dialog (#31): the default period, the
 * client checks of the period (mirroring `StripeImportService.import`), and
 * the result as summary rows. Texts live in `stripe-messages.ts`.
 */
import type { BookingFieldError } from "@/business/bookings";
import { formatCurrency, formatDate, parseIsoDate } from "@/business/format";
import {
  BOOKING_TIME_ZONE,
  stripeCreatedToBookingDate,
  type StripeImportFailure,
  type StripeImportFailureCode,
  type StripeImportFieldError,
  type StripeImportResult,
  type StripeImportStatus,
  type StripeKeyMode,
} from "@/business/stripe";
import type { BookingSearch } from "@/ui/bookings/booking-filter-model";

/** Values of the period form: ISO dates from `<input type="date">` ("" = empty). */
export interface StripeImportFormValues {
  readonly from: string;
  readonly to: string;
  /** Only asked with a test key: the user acknowledged that test fees are booked. */
  readonly confirmTestMode: boolean;
}

/**
 * Today in Europe/Berlin (`YYYY-MM-DD`) – the latest period end the import
 * accepts (`inFuture`), whatever the computer's time zone.
 */
export function berlinTodayIsoDate(now: Date = new Date()): string {
  return stripeCreatedToBookingDate(Math.floor(now.getTime() / 1000));
}

/**
 * The default period „seit dem letzten Import“: from the last imported
 * period end (that day again – fees of the rest of that day may have come
 * in after the import; booked ones are skipped) to today. Without a previous
 * import from 1 January of the current year. A stored end after today (the
 * clock went back) starts today, so the default is never invalid.
 */
export function defaultImportPeriod(
  status: StripeImportStatus,
  today: string,
): { from: string; to: string } {
  const from = status.lastImportTo ?? `${today.slice(0, 4)}-01-01`;
  return { from: from > today ? today : from, to: today };
}

/** Initial form values: the default period, no confirmation yet. */
export function stripeImportFormValues(
  status: StripeImportStatus,
  today: string,
): StripeImportFormValues {
  return { ...defaultImportPeriod(status, today), confirmTestMode: false };
}

function checkDate(value: string): "required" | "invalidDate" | undefined {
  if (value.trim() === "") return "required";
  return parseIsoDate(value) === undefined ? "invalidDate" : undefined;
}

/** Client check of `from` (same codes as the service). */
export function checkImportFrom(from: string): StripeImportFieldError | undefined {
  const code = checkDate(from);
  return code ? { field: "from", code } : undefined;
}

/**
 * Client check of `to`, in the service's order: empty/invalid, after today
 * (`inFuture`), before a valid `from` (`beforeFrom`).
 */
export function checkImportTo(
  to: string,
  from: string,
  today: string,
): StripeImportFieldError | undefined {
  const code = checkDate(to);
  if (code) return { field: "to", code };
  if (to > today) return { field: "to", code: "inFuture" };
  if (checkDate(from) === undefined && to < from) return { field: "to", code: "beforeFrom" };
  return undefined;
}

/** The service's field errors by form field (first per field). */
export function importErrorsByField(
  errors: readonly StripeImportFieldError[],
): Map<"from" | "to", StripeImportFieldError> {
  const byField = new Map<"from" | "to", StripeImportFieldError>();
  for (const error of errors) {
    if (!byField.has(error.field)) byField.set(error.field, error);
  }
  return byField;
}

/** One fee or refund that was not booked, ready to show. */
export interface StripeImportFailureRow {
  /** Unique within the result (the Stripe ID). */
  readonly key: string;
  readonly kind: "fee" | "refund";
  readonly externalId: string;
  /** `TT.MM.JJJJ`. */
  readonly date: string;
  /** Formatted with currency (`1,50 €`, `2,00 US$`). */
  readonly amount: string;
  readonly code: StripeImportFailureCode;
  readonly errors: readonly BookingFieldError[];
}

/** What the dialog shows after a successful import. */
export interface StripeImportSummary {
  readonly from: string;
  readonly to: string;
  readonly keyMode: StripeKeyMode;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  readonly fees: { readonly created: number; readonly skipped: number; readonly failed: number };
  readonly refunds: { readonly created: number; readonly skipped: number; readonly failed: number };
  readonly failures: readonly StripeImportFailureRow[];
}

/** The summary of a successful import result. */
export function stripeImportSummary(
  result: Extract<StripeImportResult, { ok: true }>,
): StripeImportSummary {
  return {
    from: result.range.from,
    to: result.range.to,
    keyMode: result.keyMode,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed.length,
    fees: result.fees,
    refunds: result.refunds,
    failures: result.failed.map(failureRow),
  };
}

function failureRow(failure: StripeImportFailure): StripeImportFailureRow {
  return {
    key: failure.externalId,
    kind: failure.kind,
    externalId: failure.externalId,
    date: formatDate(failure.date),
    amount: formatStripeAmount(failure.amount, failure.currency),
    code: failure.code,
    errors: failure.errors ?? [],
  };
}

/**
 * Currencies whose smallest unit in Stripe is not 1/100. Stripe's own lists
 * (docs.stripe.com/currencies), not CLDR's: Intl treats e.g. HUF, ISK, IDR
 * or COP as having no decimals, but Stripe still sends ×100 amounts for them.
 */
const STRIPE_ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const STRIPE_THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]);

/** Decimals of Stripe's smallest unit of `currency` (lowercase): 0, 3 or 2. */
export function stripeCurrencyDecimals(currency: string): number {
  const code = currency.toLowerCase();
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/**
 * An amount in Stripe's smallest unit of `currency` (lowercase ISO code),
 * formatted for de-DE: EUR as everywhere in the app, other currencies with
 * the decimals **Stripe** uses for them ({@link stripeCurrencyDecimals}:
 * JPY none, KWD three, HUF two). An unknown code is shown as number and
 * code.
 */
export function formatStripeAmount(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  if (code === "EUR") return formatCurrency(amount);
  const digits = stripeCurrencyDecimals(currency);
  try {
    const format = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return format.format(amount / 10 ** digits);
  } catch {
    return `${String(amount)} ${code}`;
  }
}

const timestampFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: BOOKING_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `lastImportAt` (`toISOString()`) as German date and time, Berlin time. */
export function formatImportTimestamp(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : timestampFormat.format(new Date(time));
}

/** Filters of the booking list showing the imported period's Stripe bookings. */
export function importedBookingsSearch(summary: Pick<StripeImportSummary, "from" | "to">) {
  return {
    von: summary.from,
    bis: summary.to,
    quelle: "stripe",
  } satisfies BookingSearch;
}
