/**
 * Pure logic of the EÜR year view (#26): the URL search params of `/euer`,
 * the rows of the income and expense tables and the drill-down links into
 * the booking list. No React, so it is unit-tested in Node.
 *
 * **Drill-down:** a line's bookings are exactly year + category + booking
 * type + VAT rates per contribution (`EuerContribution`, #25). The booking
 * filter (#22) combines its params with AND, so one link uses the union:
 * `von`/`bis` = the year, `kategorie` = every contributing category, `ust` =
 * every contributing rate, `art` only when all contributions share it. The
 * union is still exact, because within one year a category's bookings of one
 * rate always land in the same line (the tax status is per year): lines 15/16
 * and the VAT lines take a turnover/income category's bookings by rate alone,
 * every other line takes all rates of its categories. Categories are typed
 * (income or expense) and bookings of the other type are not counted (#25,
 * `unassignableBookings`), so a mixed line – income categories plus their
 * Erlösminderung expense categories – needs no type filter. Only such
 * unassignable bookings (other type than their category, which the services
 * do not create) may show up in a mixed line's list.
 */
import type { EuerReportLine, EuerResult, EuerWarning } from "@/business/euer";
import type { BookingType, VatRate } from "@/business/model";
import { isTaxYear } from "@/business/tax-years";
import {
  type BookingSearch,
  cleanBookingSearch,
  periodRange,
  sortedVatRateParams,
  typeParam,
  VAT_RATE_PARAMS,
  vatRateParam,
} from "@/ui/bookings/booking-filter-model";

// ---------------------------------------------------------------------------
// URL search params

/** The validated search params of `/euer`. */
export interface EuerSearch {
  /** The year shown; absent = the current calendar year. */
  readonly jahr?: number;
}

/**
 * `validateSearch` of `/euer`: a year 1000–9999 (number or numeric string),
 * otherwise dropped. The key is always present (as `undefined` when dropped),
 * so the raw value of the root route does not show through (see
 * `validateBookingSearch`).
 */
export function validateEuerSearch(raw: Readonly<Record<string, unknown>>): EuerSearch {
  const value = raw.jahr;
  const year =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{4}$/.test(value)
        ? Number(value)
        : undefined;
  return { jahr: year !== undefined && isTaxYear(year) ? year : undefined };
}

/** The year the search params show. */
export function euerSearchYear(search: EuerSearch, currentYear: number): number {
  return search.jahr ?? currentYear;
}

/** The search params for `year`: the current year is the default and not written. */
export function euerYearSearch(year: number, currentYear: number): EuerSearch {
  return year === currentYear ? {} : { jahr: year };
}

// ---------------------------------------------------------------------------
// Drill-down into the booking list

const ALL_RATES = VAT_RATE_PARAMS.length;

/**
 * The booking list's search params showing the bookings of `contributions`
 * in `year` (see the module comment); `undefined` without contributions.
 */
export function contributionsSearch(
  contributions: EuerReportLine["contributions"],
  year: number,
): BookingSearch | undefined {
  if (contributions.length === 0) return undefined;
  const categoryIds = [...new Set(contributions.map((c) => c.categoryId))];
  categoryIds.sort((a, b) => a - b);
  const types = new Set<BookingType>(contributions.map((c) => c.bookingType));
  const rates = new Set<VatRate | null>(contributions.flatMap((c) => c.vatRates));
  const ust = sortedVatRateParams([...rates].map(vatRateParam));
  const { from, to } = periodRange({ kind: "year", year });
  const [type] = types;
  return cleanBookingSearch({
    von: from,
    bis: to,
    art: types.size === 1 && type !== undefined ? typeParam(type) : undefined,
    kategorie: categoryIds,
    // Every rate is no rate filter.
    ust: ust !== undefined && ust.length < ALL_RATES ? ust : undefined,
  });
}

/** The booking list's search params of a line. */
export function lineSearch(line: EuerReportLine, year: number): BookingSearch | undefined {
  return contributionsSearch(line.contributions, year);
}

// ---------------------------------------------------------------------------
// Tables

/** A row of the income or expense table. */
export interface EuerRow {
  readonly line: EuerReportLine;
  /** "Davon" line (small business line 13): already part of another line, not summed. */
  readonly informational: boolean;
  /** Link into the booking list; absent without contributions. */
  readonly search?: BookingSearch;
}

export interface EuerTables {
  /** Income lines by line number, the informational line after the line it belongs to. */
  readonly income: readonly EuerRow[];
  readonly expenses: readonly EuerRow[];
}

function row(line: EuerReportLine, year: number, informational = false): EuerRow {
  const search = lineSearch(line, year);
  return search === undefined ? { line, informational } : { line, informational, search };
}

/**
 * The rows of both tables. Informational lines (line 13, "davon nicht
 * steuerbar") are part of line 12 (`BETRIEBSEINNAHMEN_KLEINUNTERNEHMER`) and
 * follow it; without it (cannot happen with #25's rules) they come last.
 */
export function euerTables(result: EuerResult): EuerTables {
  const income: EuerRow[] = [];
  const pending = result.informational.map((line) => row(line, result.year, true));
  for (const line of result.income) {
    income.push(row(line, result.year));
    if (line.position === "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER") income.push(...pending.splice(0));
  }
  income.push(...pending);
  return { income, expenses: result.expenses.map((line) => row(line, result.year)) };
}

/** Whether the year has no lines at all (no bookings, or none that count). */
export function isEmptyEuer(result: EuerResult): boolean {
  return (
    result.income.length === 0 && result.expenses.length === 0 && result.informational.length === 0
  );
}

export type ProfitKind = "profit" | "loss" | "zero";

export function profitKind(profitCents: number): ProfitKind {
  return profitCents > 0 ? "profit" : profitCents < 0 ? "loss" : "zero";
}

// ---------------------------------------------------------------------------
// Warnings

/** A warning of the result with what the view needs to show and link it. */
export interface EuerWarningView {
  readonly warning: EuerWarning;
  /** The line a warning is about (`negativeLine`, Bewirtung, Verpflegungsmehraufwand). */
  readonly line?: EuerReportLine;
  /** Link to the bookings concerned, where the filter can express them. */
  readonly search?: BookingSearch;
}

function allLines(result: EuerResult): EuerReportLine[] {
  return [...result.income, ...result.informational, ...result.expenses];
}

function findLine(result: EuerResult, position: EuerReportLine["position"]) {
  return allLines(result).find((line) => line.position === position);
}

function yearSearch(year: number, patch: BookingSearch): BookingSearch {
  const { from, to } = periodRange({ kind: "year", year });
  return cleanBookingSearch({ von: from, bis: to, ...patch });
}

const RATED: readonly VatRate[] = ["0", "7", "19", "reverse_charge"];

/**
 * The warnings with their line and a link to the bookings concerned:
 *
 * - `vatRateInSmallBusinessYear`: bookings of the year with any rate;
 * - `vatRateMissingInRegularYear`: bookings of the year without a rate;
 * - `vatRateOnTaxPayment`: the tax-office categories' bookings with 7/19 %;
 * - `unassignableBookings`: the categories concerned (may include counted
 *   bookings of the other type – the filter cannot tell them apart);
 * - `negativeLine`, `entertainmentSplit`, `mealAllowanceFlatRates`: the line.
 */
export function euerWarningViews(result: EuerResult): EuerWarningView[] {
  const { year } = result;
  return result.warnings.map((warning): EuerWarningView => {
    switch (warning.code) {
      case "vatRateInSmallBusinessYear":
        return {
          warning,
          search: yearSearch(year, { ust: sortedVatRateParams(RATED.map(vatRateParam)) }),
        };
      case "vatRateMissingInRegularYear":
        return { warning, search: yearSearch(year, { ust: ["ohne"] }) };
      case "vatRateOnTaxPayment": {
        const categoryIds = [
          ...new Set(
            allLines(result)
              .filter((line) => line.position === "UST_AN_FA" || line.position === "UST_ERSTATTUNG")
              .flatMap((line) => line.contributions.map((c) => c.categoryId)),
          ),
        ];
        categoryIds.sort((a, b) => a - b);
        return { warning, search: yearSearch(year, { kategorie: categoryIds, ust: ["7", "19"] }) };
      }
      case "unassignableBookings":
        return { warning, search: yearSearch(year, { kategorie: warning.categoryIds }) };
      case "negativeLine":
        return withLine(warning, findLine(result, warning.position), year);
      case "entertainmentSplit":
        return withLine(warning, findLine(result, "BEWIRTUNG"), year);
      case "mealAllowanceFlatRates":
        return withLine(warning, findLine(result, "VERPFLEGUNGSMEHRAUFWAND"), year);
    }
  });
}

function withLine(
  warning: EuerWarning,
  line: EuerReportLine | undefined,
  year: number,
): EuerWarningView {
  if (line === undefined) return { warning };
  const search = lineSearch(line, year);
  return search === undefined ? { warning, line } : { warning, line, search };
}
