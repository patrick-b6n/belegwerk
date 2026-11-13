import { describe, expect, it } from "vitest";

import { formatCurrency, parseAmount } from "./currency";

// Intl (de-DE) separates amount and symbol with a no-break space (U+00A0).
const NBSP = "\u00A0";
// Narrow no-break space, used by some locales/tools before the currency sign.
const NNBSP = "\u202F";
const MINUS_SIGN = "\u2212";

describe("formatCurrency", () => {
  it.each([
    [123456, `1.234,56${NBSP}€`],
    [0, `0,00${NBSP}€`],
    [1, `0,01${NBSP}€`],
    [29, `0,29${NBSP}€`],
    [100, `1,00${NBSP}€`],
    [1050, `10,50${NBSP}€`],
    [100000000, `1.000.000,00${NBSP}€`],
  ])("formats %i cents as %j", (cents, expected) => {
    expect(formatCurrency(cents)).toBe(expected);
  });

  it("uses a no-break space (U+00A0) before the euro sign", () => {
    const formatted = formatCurrency(123456);
    expect(formatted.charCodeAt(formatted.length - 2)).toBe(0x00a0);
    expect(formatted.replace(NBSP, " ")).toBe("1.234,56 €");
  });

  it.each([
    [-123456, `-1.234,56${NBSP}€`],
    [-5, `-0,05${NBSP}€`],
    [-100, `-1,00${NBSP}€`],
  ])("formats negative %i cents as %j", (cents, expected) => {
    expect(formatCurrency(cents)).toBe(expected);
  });

  it("is exact for the largest safe integer (no float rounding)", () => {
    expect(formatCurrency(Number.MAX_SAFE_INTEGER)).toBe(`90.071.992.547.409,91${NBSP}€`);
    expect(formatCurrency(-Number.MAX_SAFE_INTEGER)).toBe(`-90.071.992.547.409,91${NBSP}€`);
  });

  it.each([0.5, 12.34, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-integer or unsafe input %s",
    (value) => {
      expect(() => formatCurrency(value)).toThrow(RangeError);
    },
  );
});

describe("parseAmount", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12,50", 1250],
    ["0,29", 29],
    ["0,07", 7],
    ["1,1", 110],
    ["1234,56", 123456],
    ["1.234,56", 123456],
    ["1.234", 123400],
    ["1.500", 150000], // dot is always the thousands separator in de-DE
    ["12.345.678,90", 1234567890],
    ["0", 0],
    ["0,00", 0],
    ["007,5", 750],
  ])("parses %j as %i cents", (input, cents) => {
    expect(parseAmount(input)).toEqual({ ok: true, cents });
  });

  it("avoids floating-point rounding errors", () => {
    // 0.29 * 100 === 28.999999999999996 and 1.15 * 100 === 114.99999999999999
    expect(parseAmount("0,29")).toEqual({ ok: true, cents: 29 });
    expect(parseAmount("1,15")).toEqual({ ok: true, cents: 115 });
    expect(parseAmount("4,35")).toEqual({ ok: true, cents: 435 });
  });

  it.each([
    ["  12,50  ", 1250],
    [`${NBSP}12,50${NNBSP}`, 1250],
    ["1.234,56 €", 123456],
    [`1.234,56${NBSP}€`, 123456],
    [`1.234,56${NNBSP}€`, 123456],
    ["1.234,56  € ", 123456],
    ["€ 12", 1200],
    [`€${NBSP}12`, 1200],
    ["€12", 1200],
    ["12€", 1200],
  ])("tolerates whitespace at the ends and next to the euro sign in %j", (input, cents) => {
    expect(parseAmount(input)).toEqual({ ok: true, cents });
  });

  it("round-trips formatCurrency output", () => {
    for (const cents of [0, 1, 29, 123456, 100000000, Number.MAX_SAFE_INTEGER]) {
      expect(parseAmount(formatCurrency(cents))).toEqual({ ok: true, cents });
    }
  });

  it.each(["", "   ", "€", ` ${NBSP}€ `])("rejects empty input %j", (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: "empty" });
  });

  it.each(["-12", "-0,50", "- 1.234,56 €", "€ -12", `${MINUS_SIGN}12`])(
    "rejects negative input %j",
    (input) => {
      expect(parseAmount(input)).toEqual({ ok: false, error: "negative" });
    },
  );

  it.each(["1,234", "0,001", "12,500"])("rejects more than two decimals in %j", (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: "tooManyDecimals" });
  });

  it.each([
    "1 2",
    "1 50",
    "12,5 0",
    "12 34,5 6",
    "1 234,56", // space is not accepted as a group separator
    `1${NBSP}234,56`,
    `1${NNBSP}234,56`,
    "1. 234",
    "12 ,50",
  ])("rejects whitespace inside the number in %j", (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: "invalid" });
  });

  it.each([
    "abc",
    "12a",
    "12.5", // dot as decimal separator is ambiguous in de-DE
    "12.50",
    "1.23",
    "1234.567,00", // wrong grouping
    "12.34,5",
    "0.123", // leading zero group
    "01.234",
    "000.000",
    ".234",
    "1.234.",
    ",5",
    "12,",
    "1,2,3",
    "+12",
    "12 €€",
    "€12€",
    "1e3",
    "0x10",
  ])("rejects invalid input %j", (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects amounts above Number.MAX_SAFE_INTEGER cents", () => {
    expect(parseAmount("90.071.992.547.409,91")).toEqual({
      ok: true,
      cents: Number.MAX_SAFE_INTEGER,
    });
    expect(parseAmount("90.071.992.547.409,92")).toEqual({ ok: false, error: "tooLarge" });
    expect(parseAmount("99999999999999999999")).toEqual({ ok: false, error: "tooLarge" });
  });
});
