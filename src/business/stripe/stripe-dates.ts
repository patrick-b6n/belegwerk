/**
 * Stripe timestamps ↔ booking dates (#29). Stripe's `created` is an instant
 * (Unix epoch seconds, UTC); a booking has a plain calendar date. The app
 * books in German time: the booking date is the calendar date of `created`
 * in **Europe/Berlin** (CET/CEST) – a fee at 23:30 UTC on 31 Dec belongs to
 * 1 Jan of the next year, and so to the next EÜR year.
 *
 * Uses `Intl` with an explicit time zone, so the result is the same on every
 * machine whatever its local time zone.
 */
import { parseIsoDate } from "../format";

export const BOOKING_TIME_ZONE = "Europe/Berlin";

const berlinParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const SECONDS_PER_DAY = 86_400;

interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function toBerlin(epochSeconds: number): LocalDateTime {
  const values: Record<string, number> = {};
  for (const part of berlinParts.formatToParts(new Date(epochSeconds * 1000))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year ?? Number.NaN,
    month: values.month ?? Number.NaN,
    day: values.day ?? Number.NaN,
    hour: values.hour ?? Number.NaN,
    minute: values.minute ?? Number.NaN,
    second: values.second ?? Number.NaN,
  };
}

/** Offset of Berlin time to UTC at the instant, in seconds (3600 or 7200). */
function berlinOffsetSeconds(epochSeconds: number): number {
  const local = toBerlin(epochSeconds);
  const asUtc =
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) / 1000;
  return asUtc - epochSeconds;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function assertEpochSeconds(epochSeconds: number): void {
  if (!Number.isSafeInteger(epochSeconds)) {
    throw new RangeError(`Expected integer epoch seconds, got ${epochSeconds}`);
  }
}

/**
 * The booking date (`YYYY-MM-DD`) of a Stripe `created` timestamp: its
 * calendar date in Europe/Berlin.
 *
 * @throws {RangeError} if `epochSeconds` is no integer.
 */
export function stripeCreatedToBookingDate(epochSeconds: number): string {
  assertEpochSeconds(epochSeconds);
  const { year, month, day } = toBerlin(epochSeconds);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * The first second (epoch seconds) of a calendar day in Europe/Berlin –
 * 00:00 local time, which never falls into a DST gap (switches are at
 * 02:00/03:00).
 *
 * @throws {RangeError} for an invalid ISO date (see `parseIsoDate`).
 */
export function berlinStartOfDay(isoDate: string): number {
  const parts = parseIsoDate(isoDate);
  if (!parts) throw new RangeError(`Expected an existing ISO date (YYYY-MM-DD), got "${isoDate}"`);
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day) / 1000;
  // Guess with the offset at UTC midnight, then correct with the offset at
  // the guess (differs only on DST switch days).
  let result = midnightUtc - berlinOffsetSeconds(midnightUtc);
  result = midnightUtc - berlinOffsetSeconds(result);
  return result;
}

/**
 * The `created` range (inclusive, epoch seconds) of a booking-date range
 * `from`–`to` (inclusive calendar days in Europe/Berlin): from 00:00:00 of
 * `from` to 23:59:59 of `to`.
 *
 * @throws {RangeError} for invalid ISO dates or `from` after `to`.
 */
export function bookingDateRangeToStripeCreated(
  from: string,
  to: string,
): { readonly createdFrom: number; readonly createdTo: number } {
  const createdFrom = berlinStartOfDay(from);
  const toParts = parseIsoDate(to);
  if (!toParts) throw new RangeError(`Expected an existing ISO date (YYYY-MM-DD), got "${to}"`);
  const next = new Date(Date.UTC(toParts.year, toParts.month - 1, toParts.day + 1));
  const nextIso = `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  const createdTo = berlinStartOfDay(nextIso) - 1;
  if (createdTo < createdFrom) throw new RangeError(`"${from}" is after "${to}"`);
  return { createdFrom, createdTo };
}

/** `epochSeconds` minus whole days (for `STRIPE_FEE_REFUND_LOOKBACK_DAYS`). */
export function subtractDays(epochSeconds: number, days: number): number {
  assertEpochSeconds(epochSeconds);
  return epochSeconds - days * SECONDS_PER_DAY;
}
