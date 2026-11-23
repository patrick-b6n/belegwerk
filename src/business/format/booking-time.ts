/**
 * Booking days and instants. The database stores the time of a booking as a
 * UTC timestamp; the app works with its calendar day in **Europe/Berlin**. The
 * tax year is therefore the German one on every machine.
 */
import { parseIsoDate } from "./date";

export const BOOKING_TIME_ZONE = "Europe/Berlin";

/** @throws {RangeError} for an invalid ISO date (see `parseIsoDate`). */
function toPlainDate(isoDate: string): Temporal.PlainDate {
  // Temporal alone would also accept e.g. "20250307" or a date with a time.
  if (!parseIsoDate(isoDate)) {
    throw new RangeError(`Expected an existing ISO date (YYYY-MM-DD), got "${isoDate}"`);
  }
  return Temporal.PlainDate.from(isoDate);
}

function startOfDay(isoDate: string): Temporal.ZonedDateTime {
  return toPlainDate(isoDate).toZonedDateTime(BOOKING_TIME_ZONE);
}

/** The first moment after the day: the start of the next calendar day. */
function endOfDay(isoDate: string): Temporal.ZonedDateTime {
  return toPlainDate(isoDate).add({ days: 1 }).toZonedDateTime(BOOKING_TIME_ZONE);
}

function toEpochSeconds(time: Temporal.ZonedDateTime): number {
  return time.epochMilliseconds / 1000;
}

/** Same format as `Date#toISOString()`. */
function toTimestamp(time: Temporal.ZonedDateTime): string {
  return time.toInstant().toString({ fractionalSecondDigits: 3 });
}

function dayOf(instant: Temporal.Instant): string {
  return instant.toZonedDateTimeISO(BOOKING_TIME_ZONE).toPlainDate().toString();
}

/**
 * The first second (epoch seconds) of a calendar day in Europe/Berlin.
 *
 * @throws {RangeError} for an invalid ISO date (see `parseIsoDate`).
 */
export function berlinStartOfDay(isoDate: string): number {
  return toEpochSeconds(startOfDay(isoDate));
}

/** The first second (epoch seconds) after a calendar day in Europe/Berlin. */
export function berlinEndOfDay(isoDate: string): number {
  return toEpochSeconds(endOfDay(isoDate));
}

/** The calendar day (`YYYY-MM-DD`) in Europe/Berlin of epoch seconds. */
export function berlinDay(epochSeconds: number): string {
  return dayOf(Temporal.Instant.fromEpochMilliseconds(epochSeconds * 1000));
}

/** UTC timestamp (`toISOString()`) of 00:00 in Europe/Berlin on a calendar day. */
export function startOfBookingDay(isoDate: string): string {
  return toTimestamp(startOfDay(isoDate));
}

/** UTC timestamp of the first moment after a calendar day in Europe/Berlin. */
export function endOfBookingDay(isoDate: string): string {
  return toTimestamp(endOfDay(isoDate));
}

/**
 * The calendar day in Europe/Berlin of a UTC timestamp.
 *
 * @throws {RangeError} if `timestamp` is no timestamp with time zone.
 */
export function bookingDayOf(timestamp: string): string {
  return dayOf(Temporal.Instant.from(timestamp));
}
