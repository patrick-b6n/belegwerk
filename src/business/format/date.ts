// ISO calendar dates are formatted in UTC so the result never shifts by a
// day depending on the machine's time zone.
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parts of a valid ISO calendar date; `month` is 1–12. */
export interface IsoDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Parses an ISO calendar date (`YYYY-MM-DD`) – the same rules as
 * {@link formatDate} and the database's CHECK on `bookings.date`: exactly
 * this format, an existing day (`"2025-02-30"` is rejected) and a year in
 * 1000–9999.
 *
 * @returns the parts, or `undefined` if `isoDate` is not such a date.
 */
export function parseIsoDate(isoDate: string): IsoDateParts | undefined {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1000) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

/**
 * Formats an ISO calendar date (`YYYY-MM-DD`, e.g. a booking's payment date)
 * as `TT.MM.JJJJ` (de-DE), e.g. `"2025-03-07"` → `"07.03.2025"`.
 *
 * The input is a plain calendar date without time or time zone, so the
 * result is the same on every machine. There is deliberately no `Date`
 * overload: a `Date` is an instant, and formatting it would depend on the
 * local time zone.
 *
 * Only years 1000–9999 are supported, so the year always has four digits.
 *
 * @throws {RangeError} for malformed or non-existent dates (`"2025-02-30"`)
 *   and years outside 1000–9999 (see {@link parseIsoDate}).
 */
export function formatDate(isoDate: string): string {
  const parts = parseIsoDate(isoDate);
  if (!parts) {
    throw new RangeError(
      `Expected an existing ISO date (YYYY-MM-DD) in the years 1000–9999, got "${isoDate}"`,
    );
  }
  return dateFormat.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}
