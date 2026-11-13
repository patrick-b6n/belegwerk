/**
 * Money is stored as integer euro cents everywhere (see #1). These helpers
 * convert between cents and the German (de-DE) display/input format without
 * ever doing floating-point arithmetic on fractional euros.
 */

import { MAX_AMOUNT_CENTS } from "../money/limits";

const LOCALE = "de-DE";

const currencyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
});

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Expected an integer amount of cents, got ${cents}`);
  }
}

/**
 * Formats integer cents as a de-DE euro amount, e.g. `123456` → `"1.234,56 €"`.
 *
 * The separator before `€` is a no-break space (U+00A0), exactly as produced
 * by `Intl`, so amount and symbol never wrap onto separate lines. Negative
 * values are formatted with a leading minus (`"-1.234,56 €"`), e.g. for
 * balances.
 *
 * Intl only formats the whole euros; the cent digits are inserted from the
 * integer remainder, so the output is exact for every safe integer (no
 * `cents / 100` rounding issues on large values).
 *
 * @throws {RangeError} if `cents` is not a safe integer.
 */
export function formatCurrency(cents: number): string {
  assertCents(cents);
  const remainder = Math.abs(cents % 100);
  // |cents| - remainder is a multiple of 100, so the division is exact.
  const euros = (Math.abs(cents) - remainder) / 100;
  const centDigits = String(remainder).padStart(2, "0");

  // Intl decides sign, grouping, symbol and spacing; we only swap in the
  // exact cent digits. For -1…-99 cents, `-euros` is -0, which Intl still
  // prints with a minus sign.
  return currencyFormat
    .formatToParts(cents < 0 ? -euros : euros)
    .map((part) => (part.type === "fraction" ? centDigits : part.value))
    .join("");
}

export type ParseAmountError =
  /** Input is empty or whitespace only. */
  | "empty"
  /** Input starts with a minus sign; amounts are always entered positive (#1). */
  | "negative"
  /** More than two decimal places; we never round silently. */
  | "tooManyDecimals"
  /** Result would exceed `MAX_AMOUNT_CENTS` (100.000.000,00 €). */
  | "tooLarge"
  /** Anything else that is not a valid de-DE amount. */
  | "invalid";

export type ParseAmountResult =
  | { readonly ok: true; readonly cents: number }
  | { readonly ok: false; readonly error: ParseAmountError };

// Integer part either plain digits ("1234") or correctly grouped with dots
// ("1.234", "12.345.678", first group without leading zero); optional
// decimal comma with digits.
const AMOUNT_PATTERN = /^(\d+|[1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/;

const EURO_SIGN = "€";
const MINUS_SIGN = "\u2212";

/**
 * Parses a user-entered de-DE amount into integer cents.
 *
 * Accepted: `"12"`, `"12,5"`, `"0,29"`, `"1234,56"`, `"1.234,56"`, optionally
 * with a leading or trailing `€` (`"1.234,56 €"`, `"€ 12"`). Whitespace
 * (incl. no-break space U+00A0 and narrow no-break space U+202F) is allowed
 * only at the ends and between the number and `€`, so `formatCurrency` output
 * parses again. Whitespace inside the number (`"1 2"`, `"1 234,56"`) is
 * `"invalid"` – it is not accepted as a group separator. Zero is accepted
 * (`"0"` → `0`); whether zero is a valid booking amount is a business rule,
 * not a parsing concern.
 *
 * The dot is always the de-DE thousands separator: `"1.500"` parses as
 * 1.500 € (`150000`), not 1,50 €. UIs should therefore show a preview of
 * the parsed amount (e.g. via `formatCurrency`).
 *
 * Rejected (with a reason, never rounded or guessed):
 * - empty input → `"empty"`
 * - leading minus → `"negative"`
 * - more than two decimals (`"1,234"`) → `"tooManyDecimals"`
 * - a dot as decimal separator or wrong grouping (`"12.5"`, `"1.23"`,
 *   `"12.34,5"`, `"0.123"`), inner whitespace, a leading plus, missing
 *   integer part (`",5"`), letters, multiple commas, … → `"invalid"`
 * - more than `MAX_AMOUNT_CENTS` (100.000.000,00 €) → `"tooLarge"`
 *
 * Works purely on the digit string, so there is no floating-point rounding
 * (`"0,29"` → `29`, not `28`).
 */
export function parseAmount(input: string): ParseAmountResult {
  // String#trim removes all Unicode whitespace, incl. U+00A0 and U+202F.
  let value = input.trim();
  if (value.startsWith(EURO_SIGN)) value = value.slice(EURO_SIGN.length).trimStart();
  else if (value.endsWith(EURO_SIGN)) value = value.slice(0, -EURO_SIGN.length).trimEnd();

  if (value === "") return { ok: false, error: "empty" };
  if (value.startsWith("-") || value.startsWith(MINUS_SIGN)) {
    return { ok: false, error: "negative" };
  }

  const match = AMOUNT_PATTERN.exec(value);
  if (!match) return { ok: false, error: "invalid" };

  const integerDigits = (match[1] ?? "").replaceAll(".", "");
  const fractionDigits = match[2] ?? "";
  if (fractionDigits.length > 2) return { ok: false, error: "tooManyDecimals" };

  const cents = BigInt(integerDigits + fractionDigits.padEnd(2, "0"));
  if (cents > BigInt(MAX_AMOUNT_CENTS)) {
    return { ok: false, error: "tooLarge" };
  }
  return { ok: true, cents: Number(cents) };
}
