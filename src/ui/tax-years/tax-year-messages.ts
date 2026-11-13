/**
 * UI texts of the "Steuerjahre" settings (#20): status labels, hints and the
 * texts of the service's error codes (docs/i18n.md: business returns codes,
 * the UI translates them).
 */
import { TAX_YEAR_MAX, TAX_YEAR_MIN, type TaxYearFieldError } from "@/business/tax-years";
import { m } from "@/paraglide/messages.js";

import type { TaxYearClientError } from "./tax-year-model";

/** The status of a year: "Regelbesteuerung" or "Kleinunternehmer (§ 19 UStG)". */
export function taxStatusLabel(smallBusiness: boolean): string {
  return smallBusiness ? m.tax_years_status_small_business() : m.tax_years_status_regular();
}

/** Toast after the status of `year` was saved. */
export function taxStatusSavedMessage(year: number, smallBusiness: boolean): string {
  const params = { year: String(year) };
  return smallBusiness
    ? m.tax_years_set_small_business_toast(params)
    : m.tax_years_set_regular_toast(params);
}

/** Hint at a year with bookings whose VAT rate does not fit its status. */
export function mismatchedBookingsHint(count: number, smallBusiness: boolean): string {
  const params = { count: String(count) };
  return smallBusiness
    ? m.tax_years_mismatched_small_business(params)
    : m.tax_years_mismatched_regular(params);
}

/** Why the change of `year` to `smallBusiness` conflicts with `count` bookings. */
export function conflictDescription(year: number, smallBusiness: boolean, count: number): string {
  const params = { year: String(year), count: String(count) };
  return smallBusiness
    ? m.tax_years_conflict_to_small_business(params)
    : m.tax_years_conflict_to_regular(params);
}

const invalidYear = () =>
  m.tax_years_error_year_invalid({ min: String(TAX_YEAR_MIN), max: String(TAX_YEAR_MAX) });

/** Message of an error the service reported (`TaxYearFieldError`). */
export function taxYearErrorMessage(error: TaxYearFieldError): string {
  switch (error.field) {
    case "year":
      switch (error.code) {
        case "invalidYear":
          return invalidYear();
        case "yearExists":
          return m.tax_years_error_year_exists();
      }
      break;
    case "smallBusiness":
      return m.tax_years_error_value_invalid();
  }
  // Unreachable with the typed codes; a new code without a text is a programmer error.
  throw new Error(`No message for tax year error ${JSON.stringify(error)}`);
}

/** Message of an error the form detected itself. */
export function taxYearClientErrorMessage(error: TaxYearClientError): string {
  return error === "required" ? m.tax_years_error_year_required() : invalidYear();
}
