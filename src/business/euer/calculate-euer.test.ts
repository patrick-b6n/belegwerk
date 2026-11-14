import { describe, expect, it } from "vitest";

import type { BookingType, VatRate } from "../model";
import { MAX_AMOUNT_CENTS, splitGross } from "../money";
import type { BookingGroupSums } from "../repositories";
import {
  calculateEuer,
  type EuerCategory,
  type EuerReportLine,
  type EuerResult,
  splitEntertainment,
} from "./calculate-euer";
import type { EuerPosition } from "./positions";

// Category ids of the fixture.
const SALES = 1; // Umsatzerlöse → 15
const TAX_FREE = 2; // Steuerfreie Erlöse → 16
const VAT_REFUND = 3; // USt-Erstattung → 18
const SOFTWARE = 10; // EDV_KOSTEN
const ENTERTAINMENT = 11; // BEWIRTUNG
const MEALS = 12; // VERPFLEGUNGSMEHRAUFWAND
const VAT_PAYMENT = 13; // UST_AN_FA
const REFUND = 14; // Erlösminderung → reduces 15
const REFUND_TAX_FREE = 15; // Erlösminderung → reduces 16
const FEES = 16; // SONSTIGE_AUSGABEN
const OTHER = 17; // SONSTIGE_AUSGABEN (second category, same position)

const category = (
  id: number,
  type: BookingType,
  euerPosition: string,
  reducesIncome = false,
): EuerCategory => ({ id, type, euerPosition, reducesIncome });

const CATEGORIES: readonly EuerCategory[] = [
  category(SALES, "income", "BETRIEBSEINNAHMEN_UST_PFLICHTIG"),
  category(TAX_FREE, "income", "BETRIEBSEINNAHMEN_UST_FREI"),
  category(VAT_REFUND, "income", "UST_ERSTATTUNG"),
  category(SOFTWARE, "expense", "EDV_KOSTEN"),
  category(ENTERTAINMENT, "expense", "BEWIRTUNG"),
  category(MEALS, "expense", "VERPFLEGUNGSMEHRAUFWAND"),
  category(VAT_PAYMENT, "expense", "UST_AN_FA"),
  category(REFUND, "expense", "BETRIEBSEINNAHMEN_UST_PFLICHTIG", true),
  category(REFUND_TAX_FREE, "expense", "BETRIEBSEINNAHMEN_UST_FREI", true),
  category(FEES, "expense", "SONSTIGE_AUSGABEN"),
  category(OTHER, "expense", "SONSTIGE_AUSGABEN"),
];

const TYPE_OF = new Map(CATEGORIES.map(({ id, type }) => [id, type]));

/** One booking as a group of one, amounts split like the booking service does. */
function booking(
  categoryId: number,
  grossCents: number,
  vatRate: VatRate | null,
): BookingGroupSums {
  const { netCents, vatCents } = splitGross(grossCents, vatRate);
  return {
    categoryId,
    type: TYPE_OF.get(categoryId) ?? "income",
    vatRate,
    count: 1,
    grossCents,
    netCents,
    vatCents,
  };
}

function euer(
  groups: readonly BookingGroupSums[],
  { year = 2025, smallBusiness = false, categories = CATEGORIES } = {},
): EuerResult {
  return calculateEuer({ year, smallBusiness, groups, categories });
}

const regular = (groups: readonly BookingGroupSums[], year = 2025) => euer(groups, { year });
const small = (groups: readonly BookingGroupSums[], year = 2025) =>
  euer(groups, { year, smallBusiness: true });

/** All lines (income, expenses, informational) by position. */
function linesOf(result: EuerResult): Map<EuerPosition, EuerReportLine> {
  return new Map(
    [...result.income, ...result.expenses, ...result.informational].map((line) => [
      line.position,
      line,
    ]),
  );
}

/** `position → amountCents` of a list, in its order. */
function amounts(lines: readonly EuerReportLine[]): [EuerPosition, number][] {
  return lines.map((line) => [line.position, line.amountCents]);
}

describe("calculateEuer – empty year", () => {
  it("has no lines, zero totals and no warnings", () => {
    expect(regular([])).toEqual({
      year: 2025,
      smallBusiness: false,
      hasLineMapping: true,
      income: [],
      expenses: [],
      informational: [],
      totals: { incomeCents: 0, expenseCents: 0, profitCents: 0 },
      warnings: [],
    });
    expect(small([], 2024)).toMatchObject({
      year: 2024,
      smallBusiness: true,
      hasLineMapping: false,
      income: [],
      totals: { incomeCents: 0, expenseCents: 0, profitCents: 0 },
    });
  });

  it("ignores categories without bookings", () => {
    expect(regular([]).expenses).toEqual([]);
  });
});

describe("calculateEuer – regularly taxed", () => {
  it("puts net amounts into the category position and VAT into lines 17 and 57", () => {
    const result = regular([booking(SALES, 11900, "19"), booking(SOFTWARE, 1190, "19")]);

    expect(result.income).toEqual([
      {
        position: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        line: 15,
        label:
          "Umsatzsteuerpflichtige Betriebseinnahmen (ohne solche zum ermäßigten Steuersatz von 0 %)",
        amountCents: 10000,
        bookingCount: 1,
        contributions: [
          {
            categoryId: SALES,
            bookingType: "income",
            vatRates: ["19"],
            bookingCount: 1,
            amountCents: 10000,
          },
        ],
      },
      {
        position: "UST_VEREINNAHMT",
        line: 17,
        label: "Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben",
        amountCents: 1900,
        bookingCount: 1,
        contributions: [
          {
            categoryId: SALES,
            bookingType: "income",
            vatRates: ["19"],
            bookingCount: 1,
            amountCents: 1900,
          },
        ],
      },
    ]);
    expect(amounts(result.expenses)).toEqual([
      ["EDV_KOSTEN", 1000],
      ["VORSTEUER", 190],
    ]);
    expect(result.expenses.map((line) => line.line)).toEqual([50, 57]);
    expect(result.informational).toEqual([]);
    expect(result.totals).toEqual({ incomeCents: 11900, expenseCents: 1190, profitCents: 10710 });
    expect(result.warnings).toEqual([]);
  });

  it("handles 7 % like 19 %", () => {
    const result = regular([booking(SALES, 10700, "7"), booking(SOFTWARE, 535, "7")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 10000],
      ["UST_VEREINNAHMT", 700],
    ]);
    expect(amounts(result.expenses)).toEqual([
      ["EDV_KOSTEN", 500],
      ["VORSTEUER", 35],
    ]);
  });

  it("puts income with rate 0, reverse charge or no rate into line 16, whatever turnover category", () => {
    const result = regular([
      booking(SALES, 1000, "0"),
      booking(SALES, 2000, "reverse_charge"),
      booking(SALES, 400, null),
      booking(TAX_FREE, 300, "0"),
    ]);
    expect(result.income).toEqual([
      expect.objectContaining({
        position: "BETRIEBSEINNAHMEN_UST_FREI",
        line: 16,
        amountCents: 3700,
        bookingCount: 4,
        contributions: [
          {
            categoryId: SALES,
            bookingType: "income",
            vatRates: [null, "0", "reverse_charge"],
            bookingCount: 3,
            amountCents: 3400,
          },
          {
            categoryId: TAX_FREE,
            bookingType: "income",
            vatRates: ["0"],
            bookingCount: 1,
            amountCents: 300,
          },
        ],
      }),
    ]);
    expect(result.totals.incomeCents).toBe(3700);
    // No VAT line for untaxed income.
    expect(linesOf(result).has("UST_VEREINNAHMT")).toBe(false);
  });

  it("puts taxed income of a tax-free category into line 15", () => {
    const result = regular([booking(TAX_FREE, 11900, "19")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 10000],
      ["UST_VEREINNAHMT", 1900],
    ]);
  });

  it("counts bookings without a rate with net = gross and reports them", () => {
    const result = regular([
      booking(SOFTWARE, 1190, null),
      booking(SALES, 500, null),
      booking(SOFTWARE, 1190, "19"),
    ]);
    expect(amounts(result.expenses)).toEqual([
      ["EDV_KOSTEN", 2190],
      ["VORSTEUER", 190],
    ]);
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_UST_FREI", 500]]);
    expect(result.warnings).toEqual([{ code: "vatRateMissingInRegularYear", bookingCount: 2 }]);
  });

  it("counts expenses with rate 0 or reverse charge at net = gross without input VAT", () => {
    const result = regular([booking(SOFTWARE, 1000, "0"), booking(FEES, 250, "reverse_charge")]);
    expect(amounts(result.expenses)).toEqual([
      ["EDV_KOSTEN", 1000],
      ["SONSTIGE_AUSGABEN", 250],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("counts VAT refunds from and payments to the tax office in lines 18 and 58", () => {
    const result = regular([booking(VAT_REFUND, 800, "0"), booking(VAT_PAYMENT, 3000, "0")]);
    expect(result.income).toEqual([
      expect.objectContaining({ position: "UST_ERSTATTUNG", line: 18, amountCents: 800 }),
    ]);
    expect(result.expenses).toEqual([
      expect.objectContaining({ position: "UST_AN_FA", line: 58, amountCents: 3000 }),
    ]);
    expect(result.totals).toEqual({ incomeCents: 800, expenseCents: 3000, profitCents: -2200 });
  });
});

describe("calculateEuer – VAT payments to and refunds from the tax office", () => {
  it("counts the full gross amount in lines 18 and 58 even with rate 19 % (regularly taxed)", () => {
    const result = regular([booking(VAT_PAYMENT, 1190, "19"), booking(VAT_REFUND, 1190, "19")]);
    expect(result.income).toEqual([
      {
        position: "UST_ERSTATTUNG",
        line: 18,
        label: expect.any(String) as string,
        amountCents: 1190,
        bookingCount: 1,
        contributions: [
          {
            categoryId: VAT_REFUND,
            bookingType: "income",
            vatRates: ["19"],
            bookingCount: 1,
            amountCents: 1190,
          },
        ],
      },
    ]);
    expect(amounts(result.expenses)).toEqual([["UST_AN_FA", 1190]]);
    const positions = [...linesOf(result).keys()];
    expect(positions).not.toContain("UST_VEREINNAHMT");
    expect(positions).not.toContain("VORSTEUER");
    expect(result.totals).toEqual({ incomeCents: 1190, expenseCents: 1190, profitCents: 0 });
    expect(result.warnings).toEqual([{ code: "vatRateOnTaxPayment", bookingCount: 2 }]);
  });

  it("counts 7 % the same and does not warn for rate 0 or reverse charge", () => {
    const result = regular([
      booking(VAT_PAYMENT, 107, "7"),
      booking(VAT_PAYMENT, 100, "0"),
      booking(VAT_REFUND, 50, "reverse_charge"),
    ]);
    expect(amounts(result.expenses)).toEqual([["UST_AN_FA", 207]]);
    expect(amounts(result.income)).toEqual([["UST_ERSTATTUNG", 50]]);
    expect(result.warnings).toEqual([{ code: "vatRateOnTaxPayment", bookingCount: 1 }]);
  });

  it("counts the full amount in a small-business year, reporting the rate only as mismatched", () => {
    const result = small([booking(VAT_PAYMENT, 1190, "19"), booking(VAT_REFUND, 500, null)]);
    expect(amounts(result.expenses)).toEqual([["UST_AN_FA", 1190]]);
    expect(amounts(result.income)).toEqual([["UST_ERSTATTUNG", 500]]);
    expect(result.warnings).toEqual([{ code: "vatRateInSmallBusinessYear", bookingCount: 1 }]);
  });

  it("reports a missing rate in a regularly taxed year", () => {
    const result = regular([booking(VAT_PAYMENT, 300, null)]);
    expect(amounts(result.expenses)).toEqual([["UST_AN_FA", 300]]);
    expect(result.warnings).toEqual([{ code: "vatRateMissingInRegularYear", bookingCount: 1 }]);
  });
});

describe("calculateEuer – Erlösminderung (reduces income)", () => {
  it("subtracts net from line 15 and the VAT share from line 17 (regularly taxed)", () => {
    const result = regular([booking(SALES, 11900, "19"), booking(REFUND, 1190, "19")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 9000],
      ["UST_VEREINNAHMT", 1710],
    ]);
    expect(result.expenses).toEqual([]);
    expect(linesOf(result).get("BETRIEBSEINNAHMEN_UST_PFLICHTIG")?.contributions).toEqual([
      {
        categoryId: SALES,
        bookingType: "income",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: 10000,
      },
      {
        categoryId: REFUND,
        bookingType: "expense",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: -1000,
      },
    ]);
    expect(linesOf(result).get("UST_VEREINNAHMT")?.contributions).toEqual([
      {
        categoryId: SALES,
        bookingType: "income",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: 1900,
      },
      {
        categoryId: REFUND,
        bookingType: "expense",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: -190,
      },
    ]);
    expect(result.totals).toEqual({ incomeCents: 10710, expenseCents: 0, profitCents: 10710 });
    expect(linesOf(result).has("VORSTEUER")).toBe(false);
  });

  it("reduces line 16 for refunds with rate 0, reverse charge or none", () => {
    const result = regular([
      booking(SALES, 5000, "reverse_charge"),
      booking(REFUND, 1000, "reverse_charge"),
      booking(REFUND, 500, "0"),
      booking(REFUND_TAX_FREE, 200, null),
    ]);
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_UST_FREI", 3300]]);
    expect(result.warnings).toEqual([{ code: "vatRateMissingInRegularYear", bookingCount: 1 }]);
  });

  it("moves taxed income and its refund in a tax-free category to lines 15 and 17", () => {
    const result = regular([booking(TAX_FREE, 11900, "19"), booking(REFUND_TAX_FREE, 1190, "19")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 9000],
      ["UST_VEREINNAHMT", 1710],
    ]);
    expect(linesOf(result).get("BETRIEBSEINNAHMEN_UST_PFLICHTIG")?.contributions).toEqual([
      {
        categoryId: TAX_FREE,
        bookingType: "income",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: 10000,
      },
      {
        categoryId: REFUND_TAX_FREE,
        bookingType: "expense",
        vatRates: ["19"],
        bookingCount: 1,
        amountCents: -1000,
      },
    ]);
  });

  it("keeps a negative line and warns", () => {
    const result = regular([booking(SALES, 1190, "19"), booking(REFUND, 2380, "19")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", -1000],
      ["UST_VEREINNAHMT", -190],
    ]);
    expect(result.totals).toEqual({ incomeCents: -1190, expenseCents: 0, profitCents: -1190 });
    expect(result.warnings).toEqual([
      { code: "negativeLine", position: "BETRIEBSEINNAHMEN_UST_PFLICHTIG" },
      { code: "negativeLine", position: "UST_VEREINNAHMT" },
    ]);
  });

  it("creates the reduced line even without income in it", () => {
    const result = regular([booking(REFUND, 119, "19")]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", -100],
      ["UST_VEREINNAHMT", -19],
    ]);
  });

  it("subtracts gross from line 12 in a small-business year", () => {
    const result = small([booking(SALES, 10000, null), booking(REFUND, 1500, null)]);
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_KLEINUNTERNEHMER", 8500]]);
    expect(result.informational).toEqual([]);
    expect(result.totals).toEqual({ incomeCents: 8500, expenseCents: 0, profitCents: 8500 });
  });

  it("also reduces line 13 when it reduces tax-free turnover (small business)", () => {
    const result = small([
      booking(SALES, 10000, null),
      booking(TAX_FREE, 3000, null),
      booking(REFUND_TAX_FREE, 1000, null),
    ]);
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_KLEINUNTERNEHMER", 12000]]);
    expect(amounts(result.informational)).toEqual([
      ["BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR", 2000],
    ]);
  });

  it("recognizes Erlösminderung by flag and position, not by name", () => {
    const categories = [
      category(1, "income", "BETRIEBSEINNAHMEN_UST_PFLICHTIG"),
      // Any id, renamed or user-created: only position and flag count.
      category(99, "expense", "BETRIEBSEINNAHMEN_UST_PFLICHTIG", true),
    ];
    const groups: BookingGroupSums[] = [
      { ...booking(SALES, 11900, "19"), categoryId: 1 },
      { ...booking(REFUND, 119, "19"), categoryId: 99 },
    ];
    expect(amounts(euer(groups, { categories }).income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 9900],
      ["UST_VEREINNAHMT", 1881],
    ]);
  });
});

describe("calculateEuer – small business (Kleinunternehmer)", () => {
  it("puts gross amounts into the positions, turnover into line 12, and has no VAT lines", () => {
    const result = small([
      booking(SALES, 11900, null),
      booking(TAX_FREE, 500, null),
      booking(SOFTWARE, 1190, null),
      booking(FEES, 300, null),
    ]);
    expect(result.income).toEqual([
      expect.objectContaining({
        position: "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
        line: 12,
        amountCents: 12400,
        bookingCount: 2,
        contributions: [
          expect.objectContaining({ categoryId: SALES, amountCents: 11900 }),
          expect.objectContaining({ categoryId: TAX_FREE, amountCents: 500 }),
        ],
      }),
    ]);
    expect(result.informational).toEqual([
      expect.objectContaining({
        position: "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR",
        line: 13,
        amountCents: 500,
        bookingCount: 1,
      }),
    ]);
    expect(amounts(result.expenses)).toEqual([
      ["EDV_KOSTEN", 1190],
      ["SONSTIGE_AUSGABEN", 300],
    ]);
    // Line 13 is not part of the totals.
    expect(result.totals).toEqual({ incomeCents: 12400, expenseCents: 1490, profitCents: 10910 });
    expect(result.warnings).toEqual([]);
  });

  it("ignores stored rates: gross counts, no VAT lines, mismatched bookings are reported", () => {
    const result = small([
      booking(SALES, 11900, "19"),
      booking(SALES, 1000, "0"),
      booking(SOFTWARE, 1190, "19"),
      booking(SOFTWARE, 100, null),
    ]);
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_KLEINUNTERNEHMER", 12900]]);
    expect(amounts(result.expenses)).toEqual([["EDV_KOSTEN", 1290]]);
    const positions = [...linesOf(result).keys()];
    expect(positions).not.toContain("UST_VEREINNAHMT");
    expect(positions).not.toContain("VORSTEUER");
    // Rate "0" does not route anything to line 16 / 13 in a small-business year.
    expect(result.informational).toEqual([]);
    expect(result.warnings).toEqual([{ code: "vatRateInSmallBusinessYear", bookingCount: 3 }]);
  });

  it("keeps VAT refunds, VAT payments (e.g. § 13b) and all expenses in their positions", () => {
    const result = small([booking(VAT_REFUND, 200, null), booking(VAT_PAYMENT, 1900, null)]);
    expect(result.income).toEqual([
      expect.objectContaining({ position: "UST_ERSTATTUNG", line: 18, amountCents: 200 }),
    ]);
    expect(result.expenses).toEqual([
      expect.objectContaining({ position: "UST_AN_FA", line: 58, amountCents: 1900 }),
    ]);
  });
});

describe("calculateEuer – Bewirtung and Verpflegungsmehraufwand", () => {
  it("counts 70 % of entertainment as expense, input VAT in full", () => {
    const result = regular([booking(ENTERTAINMENT, 11900, "19")]);
    expect(result.expenses).toEqual([
      expect.objectContaining({ position: "VORSTEUER", line: 57, amountCents: 1900 }),
      expect.objectContaining({
        position: "BEWIRTUNG",
        line: 63,
        amountCents: 7000,
        bookingCount: 1,
        entertainment: { totalCents: 10000, deductibleCents: 7000, nonDeductibleCents: 3000 },
        contributions: [expect.objectContaining({ categoryId: ENTERTAINMENT, amountCents: 10000 })],
      }),
    ]);
    expect(result.totals.expenseCents).toBe(8900);
    expect(result.warnings).toEqual([{ code: "entertainmentSplit" }]);
  });

  it("splits the gross amount in a small-business year", () => {
    const result = small([booking(ENTERTAINMENT, 5950, null)]);
    expect(linesOf(result).get("BEWIRTUNG")).toMatchObject({
      amountCents: 4165,
      entertainment: { totalCents: 5950, deductibleCents: 4165, nonDeductibleCents: 1785 },
    });
  });

  it("rounds the non-deductible part once on the year's total", () => {
    // Per booking: 3 × round(0.3 × 5) = 3 × 2 = 6; on the total: round(4.5) = 5.
    const result = small([
      booking(ENTERTAINMENT, 5, null),
      booking(ENTERTAINMENT, 5, null),
      booking(ENTERTAINMENT, 5, null),
    ]);
    expect(linesOf(result).get("BEWIRTUNG")?.entertainment).toEqual({
      totalCents: 15,
      deductibleCents: 10,
      nonDeductibleCents: 5,
    });
    expect(result.totals.expenseCents).toBe(10);
  });

  it("notes Verpflegungsmehraufwand (flat rates) and counts it as recorded", () => {
    const result = regular([booking(MEALS, 2800, "0"), booking(ENTERTAINMENT, 100, "0")]);
    expect(amounts(result.expenses)).toEqual([
      ["BEWIRTUNG", 70],
      ["VERPFLEGUNGSMEHRAUFWAND", 2800],
    ]);
    expect(result.warnings).toEqual([
      { code: "entertainmentSplit" },
      { code: "mealAllowanceFlatRates" },
    ]);
  });
});

describe("splitEntertainment", () => {
  it.each([
    [0, 0],
    [1, 0], // 0.3
    [2, 1], // 0.6
    [5, 2], // 1.5 → half up
    [10, 3],
    [15, 5], // 4.5 → half up
    [16, 5], // 4.8
    [11, 3], // 3.3
    [10000, 3000],
  ])("total %i → non-deductible %i", (total, nonDeductible) => {
    expect(splitEntertainment(total)).toEqual({
      totalCents: total,
      deductibleCents: total - nonDeductible,
      nonDeductibleCents: nonDeductible,
    });
  });

  it("rounds negative totals away from zero", () => {
    expect(splitEntertainment(-5)).toEqual({
      totalCents: -5,
      deductibleCents: -3,
      nonDeductibleCents: -2,
    });
  });

  it("is exact for the largest totals", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const { deductibleCents, nonDeductibleCents } = splitEntertainment(total);
    expect(BigInt(nonDeductibleCents)).toBe((BigInt(total) * 3n + 5n) / 10n);
    expect(deductibleCents + nonDeductibleCents).toBe(total);
  });
});

describe("calculateEuer – line mapping", () => {
  const groups = [
    booking(SALES, 11900, "19"),
    booking(SOFTWARE, 1190, "19"),
    booking(ENTERTAINMENT, 1000, "0"),
    booking(VAT_PAYMENT, 100, "0"),
  ];

  it("uses the lines of 2025", () => {
    const result = regular(groups, 2025);
    expect(result.income.map((line) => line.line)).toEqual([15, 17]);
    expect(result.expenses.map((line) => [line.position, line.line])).toEqual([
      ["EDV_KOSTEN", 50],
      ["VORSTEUER", 57],
      ["UST_AN_FA", 58],
      ["BEWIRTUNG", 63],
    ]);
  });

  it("uses the shifted lines of 2026", () => {
    const result = regular(groups, 2026);
    expect(result.hasLineMapping).toBe(true);
    expect(result.income.map((line) => line.line)).toEqual([15, 17]);
    expect(result.expenses.map((line) => [line.position, line.line])).toEqual([
      ["EDV_KOSTEN", 51],
      ["VORSTEUER", 58],
      ["UST_AN_FA", 59],
      ["BEWIRTUNG", 64],
    ]);
    const [edv] = result.expenses;
    expect(edv?.label).toBe(linesOf(regular(groups, 2025)).get("EDV_KOSTEN")?.label);
  });

  it("gives positions only, in position order, for a year without mapping", () => {
    const result = regular(groups, 2024);
    expect(result.hasLineMapping).toBe(false);
    for (const line of [...result.income, ...result.expenses]) {
      expect(line).not.toHaveProperty("line");
      expect(line).not.toHaveProperty("label");
    }
    expect(result.income.map((line) => line.position)).toEqual([
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      "UST_VEREINNAHMT",
    ]);
    expect(result.expenses.map((line) => line.position)).toEqual([
      "EDV_KOSTEN",
      "VORSTEUER",
      "UST_AN_FA",
      "BEWIRTUNG",
    ]);
    expect(result.totals).toEqual(regular(groups, 2025).totals);
  });

  it("orders lines by line number regardless of input order", () => {
    const result = small(
      [
        booking(FEES, 100, null),
        booking(VAT_REFUND, 1, null),
        booking(SOFTWARE, 1, null),
        booking(SALES, 1, null),
      ],
      2026,
    );
    expect(result.income.map((line) => line.line)).toEqual([12, 18]);
    expect(result.expenses.map((line) => line.line)).toEqual([51, 61]);
  });
});

describe("calculateEuer – amounts", () => {
  it("adds stored per-booking net and VAT, never recomputing from gross sums", () => {
    // Each 0.10 € at 19 %: VAT round(1.597) = 2, net 8. Recomputed from the
    // gross sum 0.30 € it would be VAT 5, net 25.
    const result = regular([
      booking(SALES, 10, "19"),
      booking(SALES, 10, "19"),
      booking(SALES, 10, "19"),
    ]);
    expect(amounts(result.income)).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 24],
      ["UST_VEREINNAHMT", 6],
    ]);
    expect(result.totals.incomeCents).toBe(30);
  });

  it("adds groups with the same key and counts their bookings", () => {
    const group: BookingGroupSums = {
      categoryId: SALES,
      type: "income",
      vatRate: "19",
      count: 4,
      grossCents: 47600,
      netCents: 40000,
      vatCents: 7600,
    };
    const result = regular([group, booking(SALES, 11900, "19")]);
    expect(linesOf(result).get("BETRIEBSEINNAHMEN_UST_PFLICHTIG")).toMatchObject({
      amountCents: 50000,
      bookingCount: 5,
      contributions: [{ bookingCount: 5, amountCents: 50000 }],
    });
    expect(linesOf(result).get("UST_VEREINNAHMT")?.bookingCount).toBe(5);
  });

  it("sums several categories of one position and reports each", () => {
    const result = regular([
      booking(FEES, 100, "0"),
      booking(OTHER, 250, "0"),
      booking(FEES, 50, null),
    ]);
    expect(result.expenses).toEqual([
      expect.objectContaining({
        position: "SONSTIGE_AUSGABEN",
        amountCents: 400,
        bookingCount: 3,
        contributions: [
          {
            categoryId: FEES,
            bookingType: "expense",
            vatRates: [null, "0"],
            bookingCount: 2,
            amountCents: 150,
          },
          {
            categoryId: OTHER,
            bookingType: "expense",
            vatRates: ["0"],
            bookingCount: 1,
            amountCents: 250,
          },
        ],
      }),
    ]);
  });

  it("computes a loss", () => {
    const result = regular([booking(SALES, 1000, "0"), booking(SOFTWARE, 5000, "0")]);
    expect(result.totals).toEqual({ incomeCents: 1000, expenseCents: 5000, profitCents: -4000 });
  });

  it("stays exact with many maximum bookings", () => {
    const group: BookingGroupSums = {
      categoryId: SALES,
      type: "income",
      vatRate: "0",
      count: 900,
      grossCents: 900 * MAX_AMOUNT_CENTS,
      netCents: 900 * MAX_AMOUNT_CENTS,
      vatCents: 0,
    };
    const result = regular([
      group,
      { ...group, categoryId: SOFTWARE, type: "expense", count: 1, grossCents: 1, netCents: 1 },
    ]);
    expect(result.totals.profitCents).toBe(900 * MAX_AMOUNT_CENTS - 1);
    expect(Number.isSafeInteger(result.totals.incomeCents)).toBe(true);
  });
});

describe("calculateEuer – unassignable bookings", () => {
  it("excludes bookings of unknown, mismatched or invalid categories and reports them", () => {
    const categories = [
      ...CATEGORIES,
      category(50, "expense", "NOT_A_POSITION"),
      category(51, "expense", "UST_VEREINNAHMT"), // not assignable
      category(52, "expense", "BETRIEBSEINNAHMEN_UST_PFLICHTIG"), // income position without flag
    ];
    const groups: BookingGroupSums[] = [
      booking(SALES, 1000, "0"),
      { ...booking(SOFTWARE, 500, "0"), categoryId: 404 },
      { ...booking(SALES, 700, "0"), type: "expense" }, // income category, expense booking
      { ...booking(SOFTWARE, 100, "0"), categoryId: 50 },
      { ...booking(SOFTWARE, 100, "0"), categoryId: 51, count: 2 },
      { ...booking(SOFTWARE, 100, "0"), categoryId: 52 },
    ];
    const result = euer(groups, { categories });
    expect(amounts(result.income)).toEqual([["BETRIEBSEINNAHMEN_UST_FREI", 1000]]);
    expect(result.expenses).toEqual([]);
    expect(result.totals).toEqual({ incomeCents: 1000, expenseCents: 0, profitCents: 1000 });
    expect(result.warnings).toEqual([
      { code: "unassignableBookings", bookingCount: 6, categoryIds: [SALES, 50, 51, 52, 404] },
    ]);
  });
});

describe("calculateEuer – warnings", () => {
  it("reports in a fixed order", () => {
    const categories = [...CATEGORIES, category(50, "expense", "NOT_A_POSITION")];
    const result = euer(
      [
        booking(MEALS, 100, null),
        booking(ENTERTAINMENT, 100, null),
        booking(REFUND, 1000, null),
        booking(VAT_PAYMENT, 119, "19"),
        { ...booking(SOFTWARE, 1, null), categoryId: 50 },
      ],
      { categories },
    );
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "vatRateMissingInRegularYear",
      "vatRateOnTaxPayment",
      "unassignableBookings",
      "negativeLine",
      "entertainmentSplit",
      "mealAllowanceFlatRates",
    ]);
  });
});
