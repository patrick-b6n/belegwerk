/**
 * Pure logic of the EÜR year view (#26): the URL search params of `/euer`,
 * the rows of the income and expense tables and the drill-down links into
 * the booking list. No React, so it is unit-tested in Node.
 *
 * **Drill-down:** a line's bookings are exactly year + category + booking
 * type + VAT rates per contribution (`EuerContribution`, #25). The booking
 * filter (#22) combines its params with AND, so one link uses the union:
 * `from`/`to` = the year, `category` = every contributing category, `vat` =
 * every contributing rate, `type` only when all contributions share it. The
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
import {
  type EuerReportLine,
  type EuerResult,
  type EuerWarning,
  incomeInReportOrder,
} from "@/business/euer";
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

export interface EuerSearch {
  /** The year shown; absent = the current calendar year. */
  readonly year?: number;
}

/**
 * `validateSearch` of `/euer`: a year 1000–9999 (number or numeric string),
 * otherwise dropped. The key is always present (as `undefined` when dropped),
 * so the raw value of the root route does not show through (see
 * `validateBookingSearch`).
 */
export function validateEuerSearch(raw: Readonly<Record<string, unknown>>): EuerSearch {
  const value = raw.year;
  const year =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{4}$/.test(value)
        ? Number(value)
        : undefined;
  return { year: year !== undefined && isTaxYear(year) ? year : undefined };
}

export function euerSearchYear(search: EuerSearch, currentYear: number): number {
  return search.year ?? currentYear;
}

/** The search params for `year`: the current year is the default and not written. */
export function euerYearSearch(year: number, currentYear: number): EuerSearch {
  return year === currentYear ? {} : { year };
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
  const vat = sortedVatRateParams([...rates].map(vatRateParam));
  const { from, to } = periodRange({ kind: "year", year });
  const [type] = types;
  return cleanBookingSearch({
    from,
    to,
    type: types.size === 1 && type !== undefined ? typeParam(type) : undefined,
    category: categoryIds,
    // Every rate is no rate filter.
    vat: vat !== undefined && vat.length < ALL_RATES ? vat : undefined,
  });
}

export function lineSearch(line: EuerReportLine, year: number): BookingSearch | undefined {
  return contributionsSearch(line.contributions, year);
}

// ---------------------------------------------------------------------------
// Tables

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
 * The rows of both tables, in the order of `incomeInReportOrder` (shared
 * with the CSV export, #27): informational lines (line 13, "davon nicht
 * steuerbar") follow line 12, which they are part of.
 */
export function euerTables(result: EuerResult): EuerTables {
  return {
    income: incomeInReportOrder(result).map(({ line, informational }) =>
      row(line, result.year, informational),
    ),
    expenses: result.expenses.map((line) => row(line, result.year)),
  };
}

/**
 * Whether the year has no lines at all (no bookings, or none that count).
 * It may still have warnings (e.g. only unassignable bookings) – the view
 * shows them in the empty state too.
 */
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
  return cleanBookingSearch({ from, to, ...patch });
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
 *
 * The count in a warning and the number of bookings its link shows can
 * differ when the year has unassignable bookings: the calculation skips them
 * before counting anything else, but the filters (year, rate, category)
 * cannot exclude them – e.g. the list of `vatRateInSmallBusinessYear` may
 * also contain unassignable bookings with a rate.
 */
export function euerWarningViews(result: EuerResult): EuerWarningView[] {
  const { year } = result;
  return result.warnings.map((warning): EuerWarningView => {
    switch (warning.code) {
      case "vatRateInSmallBusinessYear":
        return {
          warning,
          search: yearSearch(year, { vat: sortedVatRateParams(RATED.map(vatRateParam)) }),
        };
      case "vatRateMissingInRegularYear":
        return { warning, search: yearSearch(year, { vat: ["none"] }) };
      case "vatRateOnTaxPayment": {
        const categoryIds = [
          ...new Set(
            allLines(result)
              .filter((line) => line.position === "UST_AN_FA" || line.position === "UST_ERSTATTUNG")
              .flatMap((line) => line.contributions.map((c) => c.categoryId)),
          ),
        ];
        categoryIds.sort((a, b) => a - b);
        return { warning, search: yearSearch(year, { category: categoryIds, vat: ["7", "19"] }) };
      }
      case "unassignableBookings":
        return { warning, search: yearSearch(year, { category: warning.categoryIds }) };
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
