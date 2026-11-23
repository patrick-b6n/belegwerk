import { TAX_YEAR_MAX, TAX_YEAR_MIN, type TaxYearFieldError } from "@/business/tax-years";
import { m } from "@/paraglide/messages.js";

import type { TaxYearClientError } from "./tax-year-model";

export function taxStatusLabel(smallBusiness: boolean): string {
  return smallBusiness ? m.tax_years_status_small_business() : m.tax_years_status_regular();
}

export function taxStatusSavedMessage(year: number, smallBusiness: boolean): string {
  const params = { year: String(year) };
  return smallBusiness
    ? m.tax_years_set_small_business_toast(params)
    : m.tax_years_set_regular_toast(params);
}

export function mismatchedBookingsHint(count: number, smallBusiness: boolean): string {
  const params = { count: String(count) };
  if (smallBusiness) {
    return count === 1
      ? m.tax_years_mismatched_small_business_one()
      : m.tax_years_mismatched_small_business_other(params);
  }
  return count === 1
    ? m.tax_years_mismatched_regular_one()
    : m.tax_years_mismatched_regular_other(params);
}

export function conflictDescription(year: number, smallBusiness: boolean, count: number): string {
  const params = { year: String(year), count: String(count) };
  if (smallBusiness) {
    return count === 1
      ? m.tax_years_conflict_to_small_business_one(params)
      : m.tax_years_conflict_to_small_business_other(params);
  }
  return count === 1
    ? m.tax_years_conflict_to_regular_one(params)
    : m.tax_years_conflict_to_regular_other(params);
}

const invalidYear = () =>
  m.tax_years_error_year_invalid({ min: String(TAX_YEAR_MIN), max: String(TAX_YEAR_MAX) });

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

export function taxYearClientErrorMessage(error: TaxYearClientError): string {
  return error === "required" ? m.tax_years_error_year_required() : invalidYear();
}
