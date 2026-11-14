/**
 * Pure logic of the "Steuerjahre" settings (#20): order of the list, the
 * suggested year of "Add year" and the client-side check of the year
 * input. No React, so it is unit-tested in Node.
 *
 * The business layer is the source of truth (`TaxYearService`): the client
 * check only covers what the form can tell without the database (empty,
 * not a year in range); `yearExists` comes from the service.
 */
import { isTaxYear, type TaxYearFieldError, type TaxYearOverview } from "@/business/tax-years";

/** Errors the form detects itself. */
export type TaxYearClientError = "required" | "invalidYear";

/** The years, oldest first (chronological, like a calendar). */
export function sortYearsAscending(years: readonly TaxYearOverview[]): TaxYearOverview[] {
  const sorted = [...years];
  sorted.sort((a, b) => a.year - b.year);
  return sorted;
}

/**
 * The year "Add year" starts with: the current year if it is not
 * listed yet, else the next one (to set the status ahead of a new year), else
 * empty.
 */
export function suggestedYear(listed: readonly number[], currentYear: number): string {
  for (const year of [currentYear, currentYear + 1]) {
    if (!listed.includes(year)) return String(year);
  }
  return "";
}

/** The year of the input, or `NaN` if it is not written as an integer (e.g. "2025.5", "20 25"). */
export function parseYear(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Client check of the year input (`undefined` = valid). */
export function checkYear(text: string): TaxYearClientError | undefined {
  if (text.trim() === "") return "required";
  return isTaxYear(parseYear(text)) ? undefined : "invalidYear";
}

/** The service's error of the year field, if any (`addYear` only reports that field). */
export function yearError(errors: readonly TaxYearFieldError[]): TaxYearFieldError | undefined {
  return errors.find((error) => error.field === "year");
}
