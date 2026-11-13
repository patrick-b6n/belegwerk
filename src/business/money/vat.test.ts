import { describe, expect, it } from "vitest";

import type { VatRate } from "../model";
import { calculateBookingAmounts, isVatRate, splitGross } from "./vat";

const TAXED_RATES = [
  ["7", 7],
  ["19", 19],
] as const;

/** Exact reference: contained VAT rounded half up, computed independently. */
function referenceVat(grossCents: number, percent: number): number {
  const numerator = BigInt(grossCents) * BigInt(percent) * 2n + BigInt(100 + percent);
  return Number(numerator / (BigInt(100 + percent) * 2n));
}

/** Net-first alternative: net = round half up (gross × 100 / (100 + rate)). */
function netFirstVat(grossCents: number, percent: number): number {
  const numerator = BigInt(grossCents) * 100n * 2n + BigInt(100 + percent);
  const net = Number(numerator / (BigInt(100 + percent) * 2n));
  return grossCents - net;
}

describe("splitGross", () => {
  it.each<[number, VatRate, number, number]>([
    // gross, rate, net, vat
    [1, "19", 1, 0],
    [2, "19", 2, 0],
    [3, "19", 3, 0], // 0.479 → 0
    [4, "19", 3, 1], // 0.639 → 1
    [119, "19", 100, 19],
    [100, "19", 84, 16], // 15.97 → 16
    [1000, "19", 840, 160], // 159.66 → 160
    [11900, "19", 10000, 1900],
    [999999, "19", 840335, 159664], // 159663.70 → 159664
    [1, "7", 1, 0],
    [2, "7", 2, 0],
    [7, "7", 7, 0], // 0.458 → 0
    [8, "7", 7, 1], // 0.523 → 1
    [107, "7", 100, 7],
    [119, "7", 111, 8], // 7.785 → 8
    [100, "7", 93, 7], // 6.54 → 7
    [10700, "7", 10000, 700],
  ])("splits %i cents at %s % into net %i + VAT %i", (gross, rate, net, vat) => {
    expect(splitGross(gross, rate)).toEqual({
      grossCents: gross,
      netCents: net,
      vatCents: vat,
      vatRate: rate,
    });
  });

  describe("rounding next to the half cent", () => {
    // The VAT quotient's fractional part is remainder / (100 + rate); the
    // remainders (d − 1) / 2 and (d + 1) / 2 are the closest to ½ cent.
    it.each([
      // rate, gross just below ½ (rounds down), expected VAT, gross just above ½ (rounds up), expected VAT
      ["7", 84, 5, 23, 2], // 5.495 → 5; 1.505 → 2
      ["19", 72, 11, 47, 8], // 11.496 → 11; 7.504 → 8
    ] as const)("rounds %s % correctly around ½", (rate, below, belowVat, above, aboveVat) => {
      expect(splitGross(below, rate).vatCents).toBe(belowVat);
      expect(splitGross(above, rate).vatCents).toBe(aboveVat);
    });

    it.each(TAXED_RATES)("finds and rounds every near-½ residue at %s %", (rate, percent) => {
      const denominator = 100 + percent;
      const lower = (denominator - 1) / 2;
      const upper = (denominator + 1) / 2;
      // [gross, expected VAT] for every gross whose remainder is next to ½.
      const cases: [number, number][] = [];
      for (let gross = 1; gross <= 10 * denominator; gross++) {
        const remainder = (gross * percent) % denominator;
        const floor = (gross * percent - remainder) / denominator;
        if (remainder === lower) cases.push([gross, floor]);
        else if (remainder === upper) cases.push([gross, floor + 1]);
      }
      // Each residue occurs once per period of 100 + rate cents.
      expect(cases).toHaveLength(20);
      for (const [gross, vat] of cases) {
        expect(splitGross(gross, rate).vatCents).toBe(vat);
      }
    });

    it.each(TAXED_RATES)(
      "never hits an exact ½ cent at %s %, so VAT-first and net-first agree",
      (rate, percent) => {
        const denominator = 100 + percent;
        // The remainder of gross × rate depends only on gross mod (100 + rate),
        // so one full period of residues covers every possible gross amount.
        const exactHalves: number[] = [];
        for (let gross = 1; gross <= denominator; gross++) {
          if (2 * ((gross * percent) % denominator) === denominator) exactHalves.push(gross);
        }
        expect(exactHalves).toEqual([]);

        const disagreements: number[] = [];
        for (let gross = 1; gross <= 100_000; gross++) {
          if (splitGross(gross, rate).vatCents !== netFirstVat(gross, percent)) {
            disagreements.push(gross);
          }
        }
        expect(disagreements).toEqual([]);
      },
    );
  });

  it.each(TAXED_RATES)(
    "holds net + VAT = gross, VAT ≥ 0 and |VAT − exact| ≤ ½ for 1…100000 cents at %s %",
    (rate, percent) => {
      const denominator = 100 + percent;
      const mismatches: { gross: number; netCents: number; vatCents: number }[] = [];
      for (let gross = 1; gross <= 100_000; gross++) {
        const { netCents, vatCents } = splitGross(gross, rate);
        const ok =
          netCents + vatCents === gross &&
          vatCents >= 0 &&
          netCents >= 0 &&
          // |vat − gross·r/d| ≤ ½  ⇔  |2·vat·d − 2·gross·r| ≤ d (exact integers)
          Math.abs(2 * vatCents * denominator - 2 * gross * percent) <= denominator &&
          vatCents === referenceVat(gross, percent);
        if (!ok) mismatches.push({ gross, netCents, vatCents });
      }
      expect(mismatches).toEqual([]);
    },
  );

  it.each<VatRate>(["0", "reverse_charge"])("has no VAT at rate %j", (rate) => {
    for (const gross of [1, 2, 107, 119, 123456, Number.MAX_SAFE_INTEGER]) {
      expect(splitGross(gross, rate)).toEqual({
        grossCents: gross,
        netCents: gross,
        vatCents: 0,
        vatRate: rate,
      });
    }
  });

  it("has no VAT without a recorded rate (small business)", () => {
    for (const gross of [1, 119, 123456, Number.MAX_SAFE_INTEGER]) {
      expect(splitGross(gross, null)).toEqual({
        grossCents: gross,
        netCents: gross,
        vatCents: 0,
        vatRate: null,
      });
    }
  });

  describe("large amounts", () => {
    it.each([
      ["7", 589256026011093, 8417943228729898],
      ["19", 1438124250756965, 7569075003984026],
    ] as const)("is exact for Number.MAX_SAFE_INTEGER at %s %", (rate, vat, net) => {
      const split = splitGross(Number.MAX_SAFE_INTEGER, rate);
      expect(split.vatCents).toBe(vat);
      expect(split.netCents).toBe(net);
      expect(split.netCents + split.vatCents).toBe(Number.MAX_SAFE_INTEGER);
    });

    it.each(TAXED_RATES)("matches the exact reference near the limit at %s %", (rate, percent) => {
      for (let offset = 0; offset < 500; offset++) {
        const gross = Number.MAX_SAFE_INTEGER - offset;
        const { netCents, vatCents } = splitGross(gross, rate);
        expect(vatCents).toBe(referenceVat(gross, percent));
        expect(netCents + vatCents).toBe(gross);
        expect(Number.isSafeInteger(netCents)).toBe(true);
      }
    });

    it("is exact where gross × 19 exceeds Number.MAX_SAFE_INTEGER", () => {
      // Floating point would already lose precision in gross × 19 here.
      const gross = Math.floor(Number.MAX_SAFE_INTEGER / 19) + 1;
      expect(Number.isSafeInteger(gross * 19)).toBe(false);
      expect(splitGross(gross, "19").vatCents).toBe(referenceVat(gross, 19));
    });
  });

  it.each([0, -1, -119, 0.5, 119.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "rejects gross amount %s",
    (gross) => {
      expect(() => splitGross(gross, "19")).toThrow(RangeError);
      expect(() => splitGross(gross, null)).toThrow(RangeError);
    },
  );

  it.each(["16", "5", "", "19%", "toString", "__proto__", 19, undefined])(
    "rejects unknown rate %j",
    (rate) => {
      expect(() => splitGross(119, rate as VatRate)).toThrow(RangeError);
    },
  );
});

describe("isVatRate", () => {
  it.each(["0", "7", "19", "reverse_charge"])("accepts %j", (rate) => {
    expect(isVatRate(rate)).toBe(true);
  });

  it.each(["16", "", "constructor", null, 19, undefined])("rejects %j", (rate) => {
    expect(isVatRate(rate)).toBe(false);
  });
});

describe("calculateBookingAmounts", () => {
  it.each<[VatRate, number, number]>([
    ["19", 10000, 1900],
    ["7", 11121, 779], // 778.50 → 779
    ["0", 11900, 0],
    ["reverse_charge", 11900, 0],
  ])("splits by rate %j in a regularly taxed year", (rate, net, vat) => {
    expect(calculateBookingAmounts(11900, rate, false)).toEqual({
      ok: true,
      grossCents: 11900,
      netCents: net,
      vatCents: vat,
      vatRate: rate,
    });
  });

  it("requires a rate in a regularly taxed year", () => {
    expect(calculateBookingAmounts(11900, null, false)).toEqual({
      ok: false,
      error: "vatRateRequired",
    });
  });

  it("records no rate in a small business year: net = gross", () => {
    expect(calculateBookingAmounts(11900, null, true)).toEqual({
      ok: true,
      grossCents: 11900,
      netCents: 11900,
      vatCents: 0,
      vatRate: null,
    });
  });

  it.each<VatRate>(["0", "7", "19", "reverse_charge"])(
    "rejects rate %j in a small business year",
    (rate) => {
      expect(calculateBookingAmounts(11900, rate, true)).toEqual({
        ok: false,
        error: "vatRateNotAllowed",
      });
    },
  );

  it("throws for invalid arguments regardless of the year", () => {
    expect(() => calculateBookingAmounts(0, null, true)).toThrow(RangeError);
    expect(() => calculateBookingAmounts(0, "19", true)).toThrow(RangeError);
    expect(() => calculateBookingAmounts(119, "16" as VatRate, false)).toThrow(RangeError);
  });
});
