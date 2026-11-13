/**
 * UI texts of the booking area: labels of types, sources and VAT rates, and
 * the booking form's and the list filters' error codes (docs/i18n.md: business
 * returns codes, the UI translates them).
 */
import {
  BOOKING_SEARCH_TEXT_MAX_LENGTH,
  BOOKING_TEXT_MAX_LENGTH,
  type BookingCsvLabels,
  type BookingFieldError,
  type BookingQueryError,
  MAX_BOOKING_QUERY_CATEGORY_IDS,
} from "@/business/bookings";
import { formatCurrency, type ParseAmountError } from "@/business/format";
import { MAX_AMOUNT_CENTS } from "@/business/money";
import type { BookingSource, BookingType, VatRate } from "@/business/model";
import { m } from "@/paraglide/messages.js";

import type { AmountInputError, ClientFieldError } from "./booking-form-model";

export const BOOKING_TYPE_LABELS: Readonly<Record<BookingType, () => string>> = {
  income: m.bookings_type_income,
  expense: m.bookings_type_expense,
};

export const BOOKING_SOURCE_LABELS: Readonly<Record<BookingSource, () => string>> = {
  manual: m.bookings_source_manual,
  stripe: m.bookings_source_stripe,
};

export const VAT_RATE_LABELS: Readonly<Record<VatRate, () => string>> = {
  "19": m.booking_vat_rate_19,
  "7": m.booking_vat_rate_7,
  "0": m.booking_vat_rate_0,
  reverse_charge: m.booking_vat_rate_reverse_charge,
};

/**
 * Texts of the CSV export (#24): the column headers are those of the list
 * and the form, the values the labels shown in the app.
 */
export function bookingCsvLabels(): BookingCsvLabels {
  return {
    columns: {
      date: m.bookings_column_date(),
      type: m.bookings_column_type(),
      description: m.bookings_column_description(),
      counterparty: m.bookings_column_counterparty(),
      category: m.bookings_column_category(),
      netCents: m.bookings_column_net(),
      vatRate: m.booking_form_vat_rate_label(),
      vatCents: m.bookings_column_vat(),
      grossCents: m.bookings_column_gross(),
      reference: m.booking_form_reference_label(),
      note: m.booking_form_note_label(),
      source: m.bookings_column_source(),
      externalId: m.booking_form_external_id_label(),
    },
    types: { income: BOOKING_TYPE_LABELS.income(), expense: BOOKING_TYPE_LABELS.expense() },
    vatRates: {
      "19": VAT_RATE_LABELS["19"](),
      "7": VAT_RATE_LABELS["7"](),
      "0": VAT_RATE_LABELS["0"](),
      reverse_charge: VAT_RATE_LABELS.reverse_charge(),
    },
    sources: { manual: BOOKING_SOURCE_LABELS.manual(), stripe: BOOKING_SOURCE_LABELS.stripe() },
  };
}

const tooLarge = () => m.booking_error_amount_too_large({ max: formatCurrency(MAX_AMOUNT_CENTS) });

const AMOUNT_INPUT_MESSAGES: Readonly<Record<AmountInputError, () => string>> = {
  empty: m.booking_error_amount_empty,
  negative: m.booking_error_amount_negative,
  tooManyDecimals: m.booking_error_amount_too_many_decimals,
  tooLarge,
  invalid: m.booking_error_amount_invalid,
  amountNotPositive: m.booking_error_amount_not_positive,
};

const tooLong = (max: number) => m.booking_error_too_long({ max: String(max) });

/** Message of an error the service reported (`BookingFieldError`). */
export function bookingErrorMessage(error: BookingFieldError): string {
  switch (error.field) {
    case "date":
      return error.code === "required"
        ? m.booking_error_date_required()
        : m.booking_error_date_invalid();
    case "type":
      return m.booking_error_type_invalid();
    case "grossCents":
      switch (error.code) {
        case "amountNotPositive":
          return m.booking_error_amount_not_positive();
        case "amountTooLarge":
          return tooLarge();
        case "amountNotInteger":
          return m.booking_error_amount_not_integer();
      }
      break;
    case "vatRate":
      switch (error.code) {
        case "vatRateInvalid":
          return m.booking_error_vat_rate_invalid();
        case "vatRateNotAllowed":
          return m.booking_error_vat_rate_not_allowed();
        case "vatRateRequired":
          return m.booking_error_vat_rate_required();
      }
      break;
    case "categoryId":
      switch (error.code) {
        case "required":
          return m.booking_error_category_required();
        case "categoryNotFound":
          return m.booking_error_category_not_found();
        case "categoryTypeMismatch":
          return m.booking_error_category_type_mismatch();
        case "categoryArchived":
          return m.booking_error_category_archived();
      }
      break;
    case "description":
      return error.code === "required"
        ? m.booking_error_description_required()
        : tooLong(BOOKING_TEXT_MAX_LENGTH.description);
    case "counterparty":
      return error.code === "required"
        ? m.booking_error_counterparty_required()
        : tooLong(BOOKING_TEXT_MAX_LENGTH.counterparty);
    case "reference":
      return tooLong(BOOKING_TEXT_MAX_LENGTH.reference);
    case "note":
      return tooLong(BOOKING_TEXT_MAX_LENGTH.note);
    case "source":
      return m.booking_error_source_invalid();
    case "externalId":
      return error.code === "externalIdDuplicate"
        ? m.booking_error_external_id_duplicate()
        : m.booking_error_external_id_too_long({
            max: String(BOOKING_TEXT_MAX_LENGTH.externalId),
          });
  }
  // Unreachable with the typed codes; a new code without a text is a programmer error.
  throw new Error(`No message for booking error ${JSON.stringify(error)}`);
}

/** Message of an error the form detected itself. */
export function clientErrorMessage(error: ClientFieldError): string {
  switch (error.field) {
    case "date":
      return m.booking_error_date_required();
    case "amount":
      return AMOUNT_INPUT_MESSAGES[error.code]();
    case "vatRate":
      return m.booking_error_vat_rate_required();
    case "categoryId":
      return m.booking_error_category_required();
    case "description":
      return m.booking_error_description_required();
    case "counterparty":
      return m.booking_error_counterparty_required();
  }
}

const amountFilterTooLarge = () =>
  m.bookings_filter_error_amount_too_large({ max: formatCurrency(MAX_AMOUNT_CENTS) });

/** Message of an amount filter input that `parseAmount` rejects. */
export function amountFilterErrorMessage(error: Exclude<ParseAmountError, "empty">): string {
  switch (error) {
    case "negative":
      return m.bookings_filter_error_amount_negative();
    case "tooManyDecimals":
      return m.bookings_filter_error_amount_too_many_decimals();
    case "tooLarge":
      return amountFilterTooLarge();
    case "invalid":
      return m.bookings_filter_error_amount_format();
  }
}

/** Message of an error `normalizeBookingQuery` reports for the list's filters (#22). */
export function bookingQueryErrorMessage(error: BookingQueryError): string {
  switch (error.code) {
    case "tooLong":
      return m.bookings_filter_error_text_too_long({
        max: String(BOOKING_SEARCH_TEXT_MAX_LENGTH),
      });
    case "invalidText":
      return m.bookings_filter_error_text_invalid();
    case "invalidDate":
      return m.bookings_filter_error_date_invalid();
    case "dateRangeInverted":
      return m.bookings_filter_error_date_range_inverted();
    case "invalidType":
      return m.bookings_filter_error_type_invalid();
    case "invalidCategoryId":
      return m.bookings_filter_error_category_invalid();
    case "tooMany":
      return m.bookings_filter_error_category_too_many({
        max: String(MAX_BOOKING_QUERY_CATEGORY_IDS),
      });
    case "invalidSource":
      return m.bookings_filter_error_source_invalid();
    case "invalidAmount":
      return m.bookings_filter_error_amount_invalid();
    case "amountRangeInverted":
      return m.bookings_filter_error_amount_range_inverted();
    // Sort order and page are not set by the filters (#23 shows them).
    case "invalidSort":
    case "invalidPage":
    case "invalidPageSize":
      return m.bookings_filter_error_other();
  }
}
