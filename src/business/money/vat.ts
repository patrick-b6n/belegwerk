/**
 * Net/VAT split of a gross amount (#12). All amounts are integer euro cents
 * (#1); the arithmetic is exact integer arithmetic (BigInt), never floating
 * point.
 *
 * Rounding: the VAT contained in a gross amount ("enthaltene USt") is
 * `gross × rate / (100 + rate)`, rounded commercially (half up – for the
 * always positive amounts here the same as half away from zero); the net
 * amount is the rest, `gross − vat`. This is how German receipts and
 * invoices state the contained VAT, and `net + vat = gross` holds by
 * construction (DB CHECK).
 *
 * VAT-first and net-first (`net = round(gross × 100 / (100 + rate))`) could
 * only disagree when the exact quotient ends in exactly ½ cent. With the
 * current rates the denominators 107 and 119 are odd, so that never happens
 * and both approaches give identical results (proven by the tests). The
 * half-up branch stays for correctness should a rate with an even
 * denominator ever be added.
 */

import type { VatRate } from "../model";

/** Percent per rate; "0" and "reverse_charge" carry no VAT. */
const PERCENT_BY_RATE: Readonly<Record<VatRate, number>> = {
  "0": 0,
  "7": 7,
  "19": 19,
  reverse_charge: 0,
};

export interface VatSplit {
  readonly grossCents: number;
  readonly netCents: number;
  readonly vatCents: number;
  /** `null` = no rate recorded (small business, §19 UStG). */
  readonly vatRate: VatRate | null;
}

export function isVatRate(value: unknown): value is VatRate {
  return typeof value === "string" && Object.hasOwn(PERCENT_BY_RATE, value);
}

/** Rounds the positive fraction `numerator / denominator` half up. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return 2n * remainder >= denominator ? quotient + 1n : quotient;
}

function containedVatCents(grossCents: number, percent: number): number {
  if (percent === 0) return 0;
  // BigInt: gross × 19 exceeds Number.MAX_SAFE_INTEGER for gross > ~4.7e14.
  const vat = divideRoundHalfUp(BigInt(grossCents) * BigInt(percent), BigInt(100 + percent));
  // vat < gross, so it is a safe integer again.
  return Number(vat);
}

/**
 * Splits a gross amount into net and VAT.
 *
 * - `"7"` / `"19"`: VAT = contained VAT rounded half up, net = gross − VAT.
 * - `"0"` and `"reverse_charge"`: VAT = 0, net = gross.
 * - `null` (no rate recorded, small business year): VAT = 0, net = gross.
 *
 * Always `netCents + vatCents === grossCents`, `netCents >= 0`,
 * `vatCents >= 0`.
 *
 * Whether a rate is allowed in the booking's year is not checked here; see
 * `calculateBookingAmounts`.
 *
 * @throws {RangeError} if `grossCents` is not a positive safe integer or
 *   `vatRate` is neither a known `VatRate` nor `null`. Both are programmer
 *   errors: the caller validates user input (amount > 0) beforehand.
 */
export function splitGross(grossCents: number, vatRate: VatRate | null): VatSplit {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new RangeError(`Expected a positive integer amount of cents, got ${grossCents}`);
  }
  if (vatRate !== null && !isVatRate(vatRate)) {
    throw new RangeError(`Unknown VAT rate ${JSON.stringify(vatRate)}`);
  }
  const vatCents = vatRate === null ? 0 : containedVatCents(grossCents, PERCENT_BY_RATE[vatRate]);
  return { grossCents, netCents: grossCents - vatCents, vatCents, vatRate };
}

export type BookingAmountsError =
  /** Small business year (§19 UStG), but a VAT rate was given. */
  | "vatRateNotAllowed"
  /** Regularly taxed year, but no VAT rate was given. */
  | "vatRateRequired";

export type BookingAmountsResult =
  | ({ readonly ok: true } & VatSplit)
  | { readonly ok: false; readonly error: BookingAmountsError };

/**
 * Computes the amounts of a booking from its gross amount, its VAT rate and
 * the tax status of the booking's year (#14, #16):
 *
 * - small business year: the rate must be `null` → net = gross, VAT 0;
 *   otherwise `"vatRateNotAllowed"`.
 * - regularly taxed year: a rate is required (`"0"`, `"7"`, `"19"`,
 *   `"reverse_charge"`); `null` → `"vatRateRequired"`.
 *
 * Rule violations are returned as result objects (they come from user input
 * and are shown in the form); invalid arguments throw like `splitGross`.
 *
 * @throws {RangeError} see `splitGross`.
 */
export function calculateBookingAmounts(
  grossCents: number,
  vatRate: VatRate | null,
  smallBusiness: boolean,
): BookingAmountsResult {
  // Validate arguments first so programmer errors are never masked by a rule result.
  const split = splitGross(grossCents, vatRate);
  if (smallBusiness && vatRate !== null) return { ok: false, error: "vatRateNotAllowed" };
  if (!smallBusiness && vatRate === null) return { ok: false, error: "vatRateRequired" };
  return { ok: true, ...split };
}
