/**
 * Booking days and instants. The database stores the time of a booking as a
 * UTC timestamp; the app works with its calendar day in **Europe/Berlin**. The
 * tax year is therefore the German one on every machine.
 */
import { parseIsoDate } from "./date";

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

/**
 * The first second (epoch seconds) of a calendar day in Europe/Berlin –
 * 00:00 local time, which never falls into a DST gap (switches are at
 * 02:00/03:00).
 *
 * @throws {RangeError} for an invalid ISO date (see `parseIsoDate`).
 */
export function berlinStartOfDay(isoDate: string): number {
  return berlinMidnight(isoDate, 0);
}

/** The first second (epoch seconds) after a calendar day in Europe/Berlin. */
export function berlinEndOfDay(isoDate: string): number {
  return berlinMidnight(isoDate, 1);
}

function berlinMidnight(isoDate: string, addDays: number): number {
  const parts = parseIsoDate(isoDate);
  if (!parts) throw new RangeError(`Expected an existing ISO date (YYYY-MM-DD), got "${isoDate}"`);
  const midnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day + addDays) / 1000;
  // Guess with the offset at UTC midnight, then correct with the offset at
  // the guess (differs only on DST switch days).
  let result = midnightUtc - berlinOffsetSeconds(midnightUtc);
  result = midnightUtc - berlinOffsetSeconds(result);
  return result;
}

/** The calendar day (`YYYY-MM-DD`) in Europe/Berlin of epoch seconds. */
export function berlinDay(epochSeconds: number): string {
  const { year, month, day } = toBerlin(epochSeconds);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** UTC timestamp (`toISOString()`) of 00:00 in Europe/Berlin on a calendar day. */
export function startOfBookingDay(isoDate: string): string {
  return new Date(berlinStartOfDay(isoDate) * 1000).toISOString();
}

/** UTC timestamp of the first moment after a calendar day in Europe/Berlin. */
export function endOfBookingDay(isoDate: string): string {
  return new Date(berlinEndOfDay(isoDate) * 1000).toISOString();
}

/** The calendar day in Europe/Berlin of a UTC timestamp. */
export function bookingDayOf(timestamp: string): string {
  return berlinDay(Math.floor(Date.parse(timestamp) / 1000));
}
