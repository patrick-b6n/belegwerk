const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// ISO calendar dates are formatted in UTC so the result never shifts by a
// day depending on the machine's time zone.
const isoDateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function assertFourDigitYear(year: number): void {
  if (year < 1000 || year > 9999) {
    throw new RangeError(`Year ${year} is outside the supported range 1000–9999`);
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a date as `TT.MM.JJJJ` (de-DE), e.g. `"2025-03-07"` → `"07.03.2025"`.
 *
 * - An ISO calendar date string (`YYYY-MM-DD`, e.g. a booking's payment
 *   date) is treated as a plain calendar date without time zone.
 * - A `Date` is formatted in the local time zone.
 *
 * Only years 1000–9999 are supported, so the year always has four digits.
 *
 * @throws {RangeError} for malformed or non-existent ISO dates
 *   (`"2025-02-30"`), invalid `Date` objects and years outside 1000–9999.
 */
export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError("Invalid Date");
    assertFourDigitYear(value.getFullYear());
    return dateFormat.format(value);
  }

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new RangeError(`Expected an ISO date (YYYY-MM-DD), got "${value}"`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];

  const date = new Date(0);
  // setUTCFullYear avoids Date.UTC's mapping of years 0–99 to 1900–1999.
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a valid calendar date: "${value}"`);
  }
  assertFourDigitYear(year);
  return isoDateFormat.format(date);
}
