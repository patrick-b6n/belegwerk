import { describe, expect, it } from "vitest";

import { calculateEuer, type EuerCategory, type EuerResult } from "@/business/euer";
import type { VatRate } from "@/business/model";
import { splitGross } from "@/business/money";
import type { BookingGroupSums } from "@/business/repositories";
import { bookingSearchToQuery, validateBookingSearch } from "@/ui/bookings/booking-filter-model";

import {
  contributionsSearch,
  euerSearchYear,
  euerTables,
  euerWarningViews,
  euerYearSearch,
  isEmptyEuer,
  lineSearch,
  profitKind,
  validateEuerSearch,
} from "./euer-model";

const SALES = 1; // Umsatzerlöse → 15 (regular) / 12 (small business)
const TAX_FREE = 2; // Steuerfreie Erlöse → 16 / 12 + 13
const VAT_REFUND = 3; // USt-Erstattung → 18
const SOFTWARE = 10; // EDV_KOSTEN
const ENTERTAINMENT = 11; // BEWIRTUNG
const MEALS = 12; // VERPFLEGUNGSMEHRAUFWAND
const VAT_PAYMENT = 13; // UST_AN_FA
const REFUND = 14; // Erlösminderung → reduces 15

const CATEGORIES: readonly EuerCategory[] = [
  {
    id: SALES,
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
  },
  {
    id: TAX_FREE,
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
    reducesIncome: false,
  },
  { id: VAT_REFUND, type: "income", euerPosition: "UST_ERSTATTUNG", reducesIncome: false },
  { id: SOFTWARE, type: "expense", euerPosition: "EDV_KOSTEN", reducesIncome: false },
  { id: ENTERTAINMENT, type: "expense", euerPosition: "BEWIRTUNG", reducesIncome: false },
  { id: MEALS, type: "expense", euerPosition: "VERPFLEGUNGSMEHRAUFWAND", reducesIncome: false },
  { id: VAT_PAYMENT, type: "expense", euerPosition: "UST_AN_FA", reducesIncome: false },
  {
    id: REFUND,
    type: "expense",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: true,
  },
];

const TYPE_OF = new Map(CATEGORIES.map(({ id, type }) => [id, type]));

/** One booking group with amounts split like the booking service does. */
function group(categoryId: number, vatRate: VatRate | null, grossCents: number, count = 1) {
  const { netCents, vatCents } = splitGross(grossCents, vatRate);
  return {
    categoryId,
    type: TYPE_OF.get(categoryId) ?? "income",
    vatRate,
    count,
    grossCents,
    netCents,
    vatCents,
  } satisfies BookingGroupSums;
}

function euer(year: number, smallBusiness: boolean, groups: BookingGroupSums[]): EuerResult {
  return calculateEuer({ year, smallBusiness, groups, categories: CATEGORIES });
}

const REGULAR_2026 = euer(2026, false, [
  group(SALES, "19", 119_00, 2),
  group(SALES, "7", 107_00),
  group(SALES, "0", 50_00),
  group(TAX_FREE, null, 20_00),
  group(REFUND, "19", 11_90),
  group(SOFTWARE, "19", 23_80),
  group(ENTERTAINMENT, "19", 119_00),
  group(VAT_PAYMENT, "19", 100_00),
  group(VAT_REFUND, "0", 30_00),
  group(MEALS, null, 28_00),
]);

const SMALL_2025 = euer(2025, true, [
  group(SALES, null, 1000_00, 3),
  group(TAX_FREE, null, 200_00),
  group(REFUND, null, 50_00),
  group(SOFTWARE, "19", 119_00),
]);

function rowOf(result: EuerResult, position: string) {
  const tables = euerTables(result);
  const row = [...tables.income, ...tables.expenses].find((r) => r.line.position === position);
  if (!row) throw new Error(`No row ${position}`);
  return row;
}

describe("validateEuerSearch", () => {
  it("keeps a valid year, number or string", () => {
    expect(validateEuerSearch({ year: 2025 })).toEqual({ year: 2025 });
    expect(validateEuerSearch({ year: "2024" })).toEqual({ year: 2024 });
  });

  it("drops anything else but keeps the key", () => {
    for (const year of [999, 10000, 2025.5, "abc", "20 25", null, undefined, [2025]]) {
      const search = validateEuerSearch({ year });
      expect(Object.hasOwn(search, "year") && search.year === undefined).toBe(true);
    }
  });

  it("defaults to the current year, which is not written", () => {
    expect(euerSearchYear({}, 2026)).toBe(2026);
    expect(euerSearchYear({ year: 2025 }, 2026)).toBe(2025);
    expect(euerYearSearch(2026, 2026)).toEqual({});
    expect(euerYearSearch(2025, 2026)).toEqual({ year: 2025 });
  });
});

describe("drill-down search params", () => {
  it("is undefined without contributions", () => {
    expect(contributionsSearch([], 2026)).toBeUndefined();
  });

  it("filters line 15 by year, both turnover categories and the taxed rates, without type", () => {
    expect(rowOf(REGULAR_2026, "BETRIEBSEINNAHMEN_UST_PFLICHTIG").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      category: [SALES, REFUND],
      vat: ["7", "19"],
    });
  });

  it("filters line 16 by the untaxed rates of its categories", () => {
    expect(rowOf(REGULAR_2026, "BETRIEBSEINNAHMEN_UST_FREI").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      type: "income",
      category: [SALES, TAX_FREE],
      vat: ["none", "0"],
    });
  });

  it("filters the VAT lines by the bookings that produced them", () => {
    expect(rowOf(REGULAR_2026, "UST_VEREINNAHMT").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      category: [SALES, REFUND],
      vat: ["7", "19"],
    });
    expect(rowOf(REGULAR_2026, "VORSTEUER").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      type: "expense",
      category: [SOFTWARE, ENTERTAINMENT],
      vat: ["19"],
    });
  });

  it("filters an expense line by its category and type", () => {
    expect(rowOf(REGULAR_2026, "UST_AN_FA").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      type: "expense",
      category: [VAT_PAYMENT],
      vat: ["19"],
    });
  });

  it("filters the small business line 12 by the remapped categories, line 13 by its own", () => {
    expect(rowOf(SMALL_2025, "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER").search).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      category: [SALES, TAX_FREE, REFUND],
      vat: ["none"],
    });
    expect(rowOf(SMALL_2025, "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR").search).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      type: "income",
      category: [TAX_FREE],
      vat: ["none"],
    });
  });

  it("drops the VAT filter when every rate contributes", () => {
    const result = euer(2026, false, [
      group(SOFTWARE, null, 1_00),
      group(SOFTWARE, "0", 1_00),
      group(SOFTWARE, "7", 1_07),
      group(SOFTWARE, "19", 1_19),
      group(SOFTWARE, "reverse_charge", 1_00),
    ]);
    expect(rowOf(result, "EDV_KOSTEN").search).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
      type: "expense",
      category: [SOFTWARE],
    });
  });

  it("gives valid booking list URLs and queries", () => {
    const tables = euerTables(REGULAR_2026);
    for (const row of [...tables.income, ...tables.expenses]) {
      const search = row.search;
      expect(search).toBeDefined();
      if (!search) continue;
      // Survives the booking list's URL validation unchanged …
      expect(validateBookingSearch(JSON.parse(JSON.stringify(search)))).toMatchObject(search);
      // … and maps to the contributions' rates.
      const query = bookingSearchToQuery(search);
      const rates = new Set(row.line.contributions.flatMap((c) => c.vatRates));
      // (No line of the fixture has every rate, so each has a VAT filter.)
      expect(new Set(query.vatRates)).toEqual(rates);
    }
  });

  it("lineSearch is the search of the line's contributions", () => {
    const line = REGULAR_2026.expenses[0];
    if (!line) throw new Error("No expense line");
    expect(lineSearch(line, 2026)).toEqual(contributionsSearch(line.contributions, 2026));
  });
});

describe("euerTables", () => {
  it("orders by line and puts the informational line 13 after line 12", () => {
    const { income, expenses } = euerTables(SMALL_2025);
    expect(income.map((row) => [row.line.line, row.informational])).toEqual([
      [12, false],
      [13, true],
    ]);
    expect(expenses.map((row) => row.line.line)).toEqual([50]);
  });

  it("keeps the regular year's lines with their 2026 numbers", () => {
    const { income, expenses } = euerTables(REGULAR_2026);
    expect(income.map((row) => row.line.line)).toEqual([15, 16, 17, 18]);
    expect(expenses.map((row) => row.line.line)).toEqual([51, 58, 59, 64, 65]);
  });

  it("shows positions without numbers for a year without mapping", () => {
    const result = euer(2024, false, [group(SALES, "19", 119_00)]);
    expect(result.hasLineMapping).toBe(false);
    const { income } = euerTables(result);
    expect(income.map((row) => [row.line.position, row.line.line])).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", undefined],
      ["UST_VEREINNAHMT", undefined],
    ]);
  });

  it("detects an empty year", () => {
    expect(isEmptyEuer(euer(2026, false, []))).toBe(true);
    expect(isEmptyEuer(REGULAR_2026)).toBe(false);
  });

  it("classifies the result", () => {
    expect(profitKind(1)).toBe("profit");
    expect(profitKind(-1)).toBe("loss");
    expect(profitKind(0)).toBe("zero");
  });
});

describe("euerWarningViews", () => {
  it("links each warning to the bookings concerned", () => {
    const views = euerWarningViews(REGULAR_2026);
    expect(views.map((view) => [view.warning.code, view.search])).toEqual([
      ["vatRateMissingInRegularYear", { from: "2026-01-01", to: "2026-12-31", vat: ["none"] }],
      [
        "vatRateOnTaxPayment",
        {
          from: "2026-01-01",
          to: "2026-12-31",
          category: [VAT_REFUND, VAT_PAYMENT],
          vat: ["7", "19"],
        },
      ],
      ["entertainmentSplit", rowOf(REGULAR_2026, "BEWIRTUNG").search],
      ["mealAllowanceFlatRates", rowOf(REGULAR_2026, "VERPFLEGUNGSMEHRAUFWAND").search],
    ]);
    expect(views[2]?.line?.entertainment).toEqual({
      totalCents: 100_00,
      deductibleCents: 70_00,
      nonDeductibleCents: 30_00,
    });
  });

  it("links small business VAT rates, negative lines and unassignable bookings", () => {
    const result = calculateEuer({
      year: 2025,
      smallBusiness: true,
      groups: [group(REFUND, null, 80_00), group(SOFTWARE, "19", 119_00), group(99, null, 5_00)],
      categories: CATEGORIES,
    });
    const views = euerWarningViews(result);
    expect(views.map((view) => [view.warning.code, view.search, view.line?.line])).toEqual([
      [
        "vatRateInSmallBusinessYear",
        { from: "2025-01-01", to: "2025-12-31", vat: ["0", "7", "19", "rc"] },
        undefined,
      ],
      ["unassignableBookings", { from: "2025-01-01", to: "2025-12-31", category: [99] }, undefined],
      [
        "negativeLine",
        {
          from: "2025-01-01",
          to: "2025-12-31",
          type: "expense",
          category: [REFUND],
          vat: ["none"],
        },
        12,
      ],
    ]);
  });
});
