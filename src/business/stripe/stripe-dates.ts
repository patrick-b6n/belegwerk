/**
 * Stripe timestamps ↔ booking dates (#29). Stripe's `created` is an instant
 * (Unix epoch seconds, UTC); a booking has a plain calendar date. The app
 * books in German time: the booking date is the calendar date of `created`
 * in **Europe/Berlin** (CET/CEST) – a fee at 23:30 UTC on 31 Dec belongs to
 * 1 Jan of the next year, and so to the next EÜR year.
 *
 * Uses `Temporal` with an explicit time zone, so the result is the same on every
 * machine whatever its local time zone.
 */
import { berlinDay, berlinEndOfDay, berlinStartOfDay } from "../format";

export { BOOKING_TIME_ZONE, berlinStartOfDay } from "../format";

const SECONDS_PER_DAY = 86_400;

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
  return berlinDay(epochSeconds);
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
  const createdTo = berlinEndOfDay(to) - 1;
  if (createdTo < createdFrom) throw new RangeError(`"${from}" is after "${to}"`);
  return { createdFrom, createdTo };
}

/** `epochSeconds` minus whole days (for `STRIPE_FEE_REFUND_LOOKBACK_DAYS`). */
export function subtractDays(epochSeconds: number, days: number): number {
  assertEpochSeconds(epochSeconds);
  return epochSeconds - days * SECONDS_PER_DAY;
}
