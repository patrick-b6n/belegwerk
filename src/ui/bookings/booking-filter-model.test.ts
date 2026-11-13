import { describe, expect, it } from "vitest";

import { BOOKING_SORT_FIELDS, normalizeBookingQuery } from "@/business/bookings";
import type { CategoryWithUsage } from "@/business/categories";
import { MAX_AMOUNT_CENTS } from "@/business/money";

import {
  BOOKING_PAGE_SIZES,
  type BookingSearch,
  bookingSearchPage,
  bookingSearchPageSize,
  bookingSearchSort,
  bookingSearchToListQuery,
  bookingSearchToQuery,
  initialSortDirection,
  nextBookingSort,
  pageRange,
  pageSearchParam,
  pageSizeSearchParam,
  parseSortParam,
  sortParam,
  sortSearchParam,
  categoriesAfterTypeChange,
  categoryFilterGroups,
  cleanBookingSearch,
  countActiveFilters,
  daysInMonth,
  detectPeriod,
  parseAmountFilter,
  type Period,
  periodRange,
  periodYear,
  periodYearOptions,
  quarterOfMonth,
  resetBookingFilters,
  searchTextParam,
  sourceParam,
  switchPeriodKind,
  typeParam,
  unknownCategoryIds,
  updateBookingSearch,
  validateBookingSearch,
} from "./booking-filter-model";

function category(
  id: number,
  name: string,
  type: CategoryWithUsage["type"],
  archived = false,
): CategoryWithUsage {
  return {
    id,
    name,
    type,
    euerPosition: "X",
    reducesIncome: false,
    archived,
    isSystem: false,
    bookingCount: 0,
  };
}

describe("validateBookingSearch", () => {
  it("is empty without params", () => {
    expect(validateBookingSearch({})).toEqual({});
  });

  it("keeps every valid param", () => {
    expect(
      validateBookingSearch({
        q: "Müller",
        von: "2025-01-01",
        bis: "2025-12-31",
        art: "ausgaben",
        kategorie: [3, 7],
        quelle: "stripe",
        betragVon: 1000,
        betragBis: 250000,
      }),
    ).toEqual({
      q: "Müller",
      von: "2025-01-01",
      bis: "2025-12-31",
      art: "ausgaben",
      kategorie: [3, 7],
      quelle: "stripe",
      betragVon: 1000,
      betragBis: 250000,
    });
  });

  it("puts the params in a fixed order", () => {
    const search = validateBookingSearch({ quelle: "manuell", q: "a", art: "einnahmen" });
    expect(JSON.stringify(search)).toBe('{"q":"a","art":"einnahmen","quelle":"manuell"}');
  });

  it("sets dropped params to undefined, so raw values of the parent route do not show through", () => {
    const search = validateBookingSearch({ art: "foo", kategorie: "abc" });
    expect(Object.hasOwn(search, "art") && search.art === undefined).toBe(true);
    expect(Object.hasOwn(search, "kategorie") && search.kategorie === undefined).toBe(true);
    const raw = { art: "foo", kategorie: "abc" };
    expect({ ...raw, ...search }).toEqual({});
  });

  it("drops unknown params", () => {
    expect(validateBookingSearch({ foo: "bar", page: 2 })).toEqual({});
  });

  it("reads a numeric search text as text", () => {
    expect(validateBookingSearch({ q: 2025 })).toEqual({ q: "2025" });
  });

  it("drops blank and non-text search texts", () => {
    expect(validateBookingSearch({ q: "   " })).toEqual({});
    expect(validateBookingSearch({ q: "​" })).toEqual({});
    expect(validateBookingSearch({ q: ["a"] })).toEqual({});
    expect(validateBookingSearch({ q: { a: 1 } })).toEqual({});
    expect(validateBookingSearch({ q: Number.NaN })).toEqual({});
  });

  it("keeps texts the business layer rejects, so the error is shown", () => {
    expect(validateBookingSearch({ q: "a\u0000b" })).toEqual({ q: "a\u0000b" });
    const long = "x".repeat(300);
    expect(validateBookingSearch({ q: long })).toEqual({ q: long });
  });

  it("drops impossible or malformed dates", () => {
    expect(validateBookingSearch({ von: "2025-02-30" })).toEqual({});
    expect(validateBookingSearch({ von: "2025-2-3" })).toEqual({});
    expect(validateBookingSearch({ bis: "0999-12-31" })).toEqual({});
    expect(validateBookingSearch({ bis: 20250101 })).toEqual({});
    expect(validateBookingSearch({ von: "2024-02-29", bis: "2023-02-29" })).toEqual({
      von: "2024-02-29",
    });
  });

  it("keeps inverted ranges, so the error is shown", () => {
    expect(
      validateBookingSearch({ von: "2025-12-31", bis: "2025-01-01", betragVon: 5, betragBis: 1 }),
    ).toEqual({ von: "2025-12-31", bis: "2025-01-01", betragVon: 5, betragBis: 1 });
  });

  it("drops unknown types and sources", () => {
    expect(validateBookingSearch({ art: "income", quelle: "manual" })).toEqual({});
    expect(validateBookingSearch({ art: "toString", quelle: "__proto__" })).toEqual({});
    expect(validateBookingSearch({ art: 1, quelle: null })).toEqual({});
  });

  it("reads amounts as numbers or digit strings", () => {
    expect(validateBookingSearch({ betragVon: "1000", betragBis: 0 })).toEqual({
      betragVon: 1000,
      betragBis: 0,
    });
  });

  it("normalizes -0 to 0", () => {
    const search = validateBookingSearch({ betragVon: -0 });
    expect(Object.is(search.betragVon, 0)).toBe(true);
  });

  it("drops amounts above the largest amount", () => {
    expect(validateBookingSearch({ betragBis: MAX_AMOUNT_CENTS })).toEqual({
      betragBis: MAX_AMOUNT_CENTS,
    });
    expect(validateBookingSearch({ betragVon: MAX_AMOUNT_CENTS + 1 })).toEqual({});
    expect(validateBookingSearch({ betragBis: String(MAX_AMOUNT_CENTS + 1) })).toEqual({});
  });

  it("drops amounts that are no integer cents ≥ 0", () => {
    for (const value of [-1, 1.5, "1,50", "1e3", "", Number.MAX_SAFE_INTEGER + 1, true]) {
      expect(validateBookingSearch({ betragVon: value })).toEqual({});
    }
  });

  it("reads categories from arrays, numbers and comma-separated strings", () => {
    expect(validateBookingSearch({ kategorie: 4 })).toEqual({ kategorie: [4] });
    expect(validateBookingSearch({ kategorie: "4" })).toEqual({ kategorie: [4] });
    expect(validateBookingSearch({ kategorie: "4, 9" })).toEqual({ kategorie: [4, 9] });
    expect(validateBookingSearch({ kategorie: ["4", 9] })).toEqual({ kategorie: [4, 9] });
  });

  it("drops invalid and duplicate category ids", () => {
    expect(validateBookingSearch({ kategorie: [0, -1, 2.5, "x", 3, 3, null] })).toEqual({
      kategorie: [3],
    });
    expect(validateBookingSearch({ kategorie: [] })).toEqual({});
    expect(validateBookingSearch({ kategorie: { a: 1 } })).toEqual({});
  });

  it("never throws", () => {
    const weird: unknown[] = [undefined, null, {}, [], [[]], Symbol("x"), () => 1, 10n];
    for (const value of weird) {
      for (const key of ["q", "von", "bis", "art", "kategorie", "quelle", "betragVon"]) {
        expect(() => validateBookingSearch({ [key]: value })).not.toThrow();
      }
    }
  });
});

describe("cleanBookingSearch / updateBookingSearch", () => {
  it("removes absent and empty values", () => {
    expect(
      cleanBookingSearch({ q: " ", von: "", bis: undefined, kategorie: [], art: undefined }),
    ).toEqual({});
  });

  it("applies a patch and removes params set to undefined", () => {
    const search: BookingSearch = { q: "a", art: "ausgaben" };
    expect(updateBookingSearch(search, { art: undefined, quelle: "stripe" })).toEqual({
      q: "a",
      quelle: "stripe",
    });
  });
});

describe("bookingSearchToQuery", () => {
  it("is empty without filters", () => {
    expect(bookingSearchToQuery({})).toEqual({});
  });

  it("maps every param to the business query", () => {
    expect(
      bookingSearchToQuery({
        q: "Müller",
        von: "2025-01-01",
        bis: "2025-03-31",
        art: "einnahmen",
        kategorie: [1, 2],
        quelle: "manuell",
        betragVon: 100,
        betragBis: 200,
      }),
    ).toEqual({
      text: "Müller",
      dateFrom: "2025-01-01",
      dateTo: "2025-03-31",
      type: "income",
      categoryIds: [1, 2],
      source: "manual",
      amountFrom: 100,
      amountTo: 200,
    });
    expect(bookingSearchToQuery({ art: "ausgaben", quelle: "stripe" })).toEqual({
      type: "expense",
      source: "stripe",
    });
  });

  it("gives queries the business layer accepts for every validated URL", () => {
    const search = validateBookingSearch({
      q: "x",
      von: "2024-02-29",
      art: "einnahmen",
      kategorie: "1,2",
      quelle: "stripe",
      betragBis: "99",
    });
    expect(normalizeBookingQuery(bookingSearchToQuery(search)).ok).toBe(true);
  });

  it("passes contradictions on to the business layer's validation", () => {
    const result = normalizeBookingQuery(
      bookingSearchToQuery(
        validateBookingSearch({ von: "2025-02-01", bis: "2025-01-01", betragVon: 2, betragBis: 1 }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "dateTo", code: "dateRangeInverted" },
        { field: "amountTo", code: "amountRangeInverted" },
      ],
    });
  });

  it("round-trips type and source params", () => {
    expect(typeParam("income")).toBe("einnahmen");
    expect(typeParam("expense")).toBe("ausgaben");
    expect(sourceParam("manual")).toBe("manuell");
    expect(sourceParam("stripe")).toBe("stripe");
  });
});

describe("countActiveFilters / resetBookingFilters", () => {
  it("counts each filter once, ranges as one", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ von: "2025-01-01", bis: "2025-12-31" })).toBe(1);
    expect(countActiveFilters({ bis: "2025-12-31", betragVon: 5 })).toBe(2);
    expect(
      countActiveFilters({
        q: "a",
        von: "2025-01-01",
        art: "ausgaben",
        kategorie: [1, 2],
        quelle: "stripe",
        betragBis: 3,
      }),
    ).toBe(6);
  });

  it("removes every filter", () => {
    expect(resetBookingFilters({ q: "a", art: "ausgaben", kategorie: [1] })).toEqual({});
  });
});

describe("searchTextParam", () => {
  it("trims and removes blank texts", () => {
    expect(searchTextParam("  Müller ")).toBe("Müller");
    expect(searchTextParam("   ")).toBeUndefined();
    expect(searchTextParam("")).toBeUndefined();
  });
});

describe("parseAmountFilter", () => {
  it("treats blank as no filter", () => {
    expect(parseAmountFilter("")).toEqual({ ok: true, cents: undefined });
    expect(parseAmountFilter("  ")).toEqual({ ok: true, cents: undefined });
  });

  it("parses de-DE amounts to cents", () => {
    expect(parseAmountFilter("1.234,56")).toEqual({ ok: true, cents: 123456 });
    expect(parseAmountFilter("0")).toEqual({ ok: true, cents: 0 });
    expect(parseAmountFilter("12,5 €")).toEqual({ ok: true, cents: 1250 });
  });

  it("reports invalid amounts", () => {
    expect(parseAmountFilter("12.5")).toEqual({ ok: false, error: "invalid" });
    expect(parseAmountFilter("-3")).toEqual({ ok: false, error: "negative" });
    expect(parseAmountFilter("1,234")).toEqual({ ok: false, error: "tooManyDecimals" });
  });
});

describe("period helpers", () => {
  it("knows the days of each month incl. leap years", () => {
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it("maps months to quarters", () => {
    expect([1, 2, 3, 4, 6, 7, 9, 10, 12].map(quarterOfMonth)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("periodRange", () => {
  it("gives no range for all", () => {
    expect(periodRange({ kind: "all" })).toEqual({});
  });

  it("covers a whole year", () => {
    expect(periodRange({ kind: "year", year: 2025 })).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("ends quarters on their last day", () => {
    expect(periodRange({ kind: "quarter", year: 2024, quarter: 1 })).toEqual({
      from: "2024-01-01",
      to: "2024-03-31",
    });
    expect(periodRange({ kind: "quarter", year: 2024, quarter: 2 })).toEqual({
      from: "2024-04-01",
      to: "2024-06-30",
    });
    expect(periodRange({ kind: "quarter", year: 2024, quarter: 3 })).toEqual({
      from: "2024-07-01",
      to: "2024-09-30",
    });
    expect(periodRange({ kind: "quarter", year: 2024, quarter: 4 })).toEqual({
      from: "2024-10-01",
      to: "2024-12-31",
    });
  });

  it("ends February on the 28th or, in leap years, the 29th", () => {
    expect(periodRange({ kind: "month", year: 2025, month: 2 })).toEqual({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(periodRange({ kind: "month", year: 2024, month: 2 })).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(periodRange({ kind: "month", year: 2025, month: 11 })).toEqual({
      from: "2025-11-01",
      to: "2025-11-30",
    });
  });

  it("passes custom bounds through", () => {
    expect(periodRange({ kind: "custom", from: "2025-01-05" })).toEqual({ from: "2025-01-05" });
    expect(periodRange({ kind: "custom" })).toEqual({});
  });
});

describe("detectPeriod", () => {
  it("is all without dates", () => {
    expect(detectPeriod(undefined, undefined)).toEqual({ kind: "all" });
  });

  it("recognizes every quick pick from its own range", () => {
    const periods: Period[] = [
      { kind: "year", year: 2024 },
      ...([1, 2, 3, 4] as const).map((quarter) => ({
        kind: "quarter" as const,
        year: 2024,
        quarter,
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        kind: "month" as const,
        year: 2024,
        month: index + 1,
      })),
      { kind: "month", year: 2023, month: 2 },
    ];
    for (const period of periods) {
      const { from, to } = periodRange(period);
      expect(detectPeriod(from, to)).toEqual(period);
    }
  });

  it("treats near misses as custom", () => {
    expect(detectPeriod("2025-02-01", "2025-02-27")).toEqual({
      kind: "custom",
      from: "2025-02-01",
      to: "2025-02-27",
    });
    // 28 February is not the end of February in a leap year.
    expect(detectPeriod("2024-02-01", "2024-02-28").kind).toBe("custom");
    // Two months, or a quarter starting in the wrong month.
    expect(detectPeriod("2025-01-01", "2025-02-28").kind).toBe("custom");
    expect(detectPeriod("2025-02-01", "2025-04-30").kind).toBe("custom");
    // Across years.
    expect(detectPeriod("2024-01-01", "2025-12-31").kind).toBe("custom");
    expect(detectPeriod("2025-01-02", "2025-12-31").kind).toBe("custom");
  });

  it("treats one bound as custom", () => {
    expect(detectPeriod("2025-01-01", undefined)).toEqual({ kind: "custom", from: "2025-01-01" });
    expect(detectPeriod(undefined, "2025-12-31")).toEqual({ kind: "custom", to: "2025-12-31" });
  });

  it("treats an inverted range as custom", () => {
    expect(detectPeriod("2025-12-31", "2025-01-01").kind).toBe("custom");
  });
});

describe("periodYear", () => {
  it("is the year of the period or of a custom bound", () => {
    expect(periodYear({ kind: "all" })).toBeUndefined();
    expect(periodYear({ kind: "month", year: 2023, month: 4 })).toBe(2023);
    expect(periodYear({ kind: "custom", from: "2022-05-01", to: "2024-01-01" })).toBe(2022);
    expect(periodYear({ kind: "custom", to: "2021-05-01" })).toBe(2021);
    expect(periodYear({ kind: "custom" })).toBeUndefined();
  });
});

describe("switchPeriodKind", () => {
  const today = { year: 2025, month: 8 };

  it("starts in the current year with today's quarter or month", () => {
    const all: Period = { kind: "all" };
    expect(switchPeriodKind(all, "year", today)).toEqual({ kind: "year", year: 2025 });
    expect(switchPeriodKind(all, "quarter", today)).toEqual({
      kind: "quarter",
      year: 2025,
      quarter: 3,
    });
    expect(switchPeriodKind(all, "month", today)).toEqual({ kind: "month", year: 2025, month: 8 });
    expect(switchPeriodKind(all, "custom", today)).toEqual({ kind: "custom" });
  });

  it("keeps the selected year, starting other years with the first quarter/month", () => {
    const year: Period = { kind: "year", year: 2023 };
    expect(switchPeriodKind(year, "quarter", today)).toEqual({
      kind: "quarter",
      year: 2023,
      quarter: 1,
    });
    expect(switchPeriodKind(year, "month", today)).toEqual({ kind: "month", year: 2023, month: 1 });
  });

  it("moves between quarter and month within each other", () => {
    expect(switchPeriodKind({ kind: "month", year: 2023, month: 11 }, "quarter", today)).toEqual({
      kind: "quarter",
      year: 2023,
      quarter: 4,
    });
    expect(switchPeriodKind({ kind: "quarter", year: 2023, quarter: 2 }, "month", today)).toEqual({
      kind: "month",
      year: 2023,
      month: 4,
    });
  });

  it("keeps the range when switching to custom", () => {
    expect(switchPeriodKind({ kind: "quarter", year: 2024, quarter: 1 }, "custom", today)).toEqual({
      kind: "custom",
      from: "2024-01-01",
      to: "2024-03-31",
    });
  });

  it("uses the starting month of a custom range", () => {
    const custom: Period = { kind: "custom", from: "2023-08-15", to: "2023-09-10" };
    expect(switchPeriodKind(custom, "month", today)).toEqual({
      kind: "month",
      year: 2023,
      month: 8,
    });
    expect(switchPeriodKind(custom, "quarter", today)).toEqual({
      kind: "quarter",
      year: 2023,
      quarter: 3,
    });
    expect(switchPeriodKind({ kind: "custom", to: "2025-11-30" }, "month", today)).toEqual({
      kind: "month",
      year: 2025,
      month: 11,
    });
  });

  it("uses the year of a custom range", () => {
    expect(
      switchPeriodKind({ kind: "custom", from: "2022-06-15", to: "2022-07-01" }, "year", today),
    ).toEqual({ kind: "year", year: 2022 });
  });

  it("clears the range when switching to all", () => {
    expect(switchPeriodKind({ kind: "year", year: 2022 }, "all", today)).toEqual({ kind: "all" });
  });
});

describe("periodYearOptions", () => {
  it("lists given, current and selected years once, newest first", () => {
    expect(periodYearOptions([2023, 2025, 2024], 2025)).toEqual([2025, 2024, 2023]);
    expect(periodYearOptions([2023], 2025, 2019)).toEqual([2025, 2023, 2019]);
    expect(periodYearOptions([], 2025, 2025)).toEqual([2025]);
  });
});

describe("categoryFilterGroups", () => {
  const categories = [
    category(1, "Wareneinkauf", "expense"),
    category(2, "Erlöse", "income"),
    category(3, "Bürobedarf", "expense", true),
    category(4, "Anlagen", "income"),
    category(5, "Ärzte", "expense"),
  ];

  it("groups by type, income first, sorted by name (de), archived included", () => {
    expect(
      categoryFilterGroups(categories, undefined).map((group) => [
        group.type,
        group.categories.map((c) => c.name),
      ]),
    ).toEqual([
      ["income", ["Anlagen", "Erlöse"]],
      ["expense", ["Ärzte", "Bürobedarf", "Wareneinkauf"]],
    ]);
  });

  it("shows only the filtered type", () => {
    expect(categoryFilterGroups(categories, "income").map((group) => group.type)).toEqual([
      "income",
    ]);
  });

  it("keeps selected categories of the other type, so they can be deselected", () => {
    expect(
      categoryFilterGroups(categories, "income", [1, 99]).map((group) => [
        group.type,
        group.categories.map((c) => c.id),
      ]),
    ).toEqual([
      ["income", [4, 2]],
      ["expense", [1]],
    ]);
  });

  it("drops empty groups", () => {
    expect(categoryFilterGroups([category(1, "A", "expense")], undefined)).toHaveLength(1);
    expect(categoryFilterGroups([], undefined)).toEqual([]);
  });
});

describe("unknownCategoryIds", () => {
  it("lists selected ids without a category", () => {
    const categories = [category(1, "A", "income")];
    expect(unknownCategoryIds(categories, [1, 5, 9])).toEqual([5, 9]);
    expect(unknownCategoryIds(categories, [1])).toEqual([]);
  });
});

describe("categoriesAfterTypeChange", () => {
  const categories = [category(1, "A", "income"), category(2, "B", "expense")];

  it("removes categories of the other type", () => {
    expect(categoriesAfterTypeChange([1, 2], categories, "income")).toEqual([1]);
    expect(categoriesAfterTypeChange([1], categories, "expense")).toBeUndefined();
  });

  it("keeps everything without a type filter, and unknown ids", () => {
    expect(categoriesAfterTypeChange([1, 2], categories, undefined)).toEqual([1, 2]);
    expect(categoriesAfterTypeChange([99, 2], categories, "expense")).toEqual([99, 2]);
    expect(categoriesAfterTypeChange(undefined, categories, "income")).toBeUndefined();
  });
});

describe("sort, page and page size params (#23)", () => {
  it("maps every sort field and direction to a param and back", () => {
    for (const field of BOOKING_SORT_FIELDS) {
      for (const direction of ["asc", "desc"] as const) {
        const param = sortParam({ field, direction });
        expect(param).toMatch(/^[a-z]+-(auf|ab)$/);
        expect(parseSortParam(param)).toEqual({ field, direction });
      }
    }
    expect(sortParam({ field: "grossCents", direction: "asc" })).toBe("brutto-auf");
    expect(sortParam({ field: "date", direction: "desc" })).toBe("datum-ab");
  });

  it("rejects unknown sort params", () => {
    for (const value of [
      "",
      "brutto",
      "-auf",
      "brutto-",
      "brutto-hoch",
      "grossCents-asc",
      5,
      null,
    ]) {
      expect(parseSortParam(value)).toBeUndefined();
    }
  });

  it("validates the params, dropping defaults and unreadable values", () => {
    expect(validateBookingSearch({ sortierung: "brutto-auf", seite: 3, proSeite: 100 })).toEqual({
      sortierung: "brutto-auf",
      seite: 3,
      proSeite: 100,
    });
    expect(validateBookingSearch({ seite: "4", proSeite: "25" })).toEqual({
      seite: 4,
      proSeite: 25,
    });
    const dropped = validateBookingSearch({ sortierung: "datum-ab", seite: 1, proSeite: 50 });
    expect(cleanBookingSearch(dropped)).toEqual({});
    for (const raw of [
      { sortierung: "foo-auf" },
      { seite: 0 },
      { seite: -2 },
      { seite: 2.5 },
      { seite: "x" },
      { proSeite: 30 },
      { proSeite: 1000 },
      { proSeite: "all" },
    ]) {
      expect(cleanBookingSearch(validateBookingSearch(raw))).toEqual({});
    }
    // Every key is present (root-search merge, see validateBookingSearch).
    const result = validateBookingSearch({ seite: "x" });
    expect(Object.hasOwn(result, "seite")).toBe(true);
    expect(result.seite).toBeUndefined();
  });

  it("starts a new column in its initial direction and flips the sorted one", () => {
    const byDate = { field: "date", direction: "desc" } as const;
    expect(nextBookingSort(byDate, "date")).toEqual({ field: "date", direction: "asc" });
    expect(nextBookingSort(byDate, "grossCents")).toEqual({
      field: "grossCents",
      direction: "desc",
    });
    expect(nextBookingSort(byDate, "description")).toEqual({
      field: "description",
      direction: "asc",
    });
    expect(nextBookingSort({ field: "source", direction: "asc" }, "source")).toEqual({
      field: "source",
      direction: "desc",
    });
    expect(initialSortDirection("netCents")).toBe("desc");
    expect(initialSortDirection("type")).toBe("asc");
  });

  it("writes params only for non-default values", () => {
    expect(sortSearchParam({ field: "date", direction: "desc" })).toBeUndefined();
    expect(sortSearchParam({ field: "date", direction: "asc" })).toBe("datum-auf");
    expect(pageSearchParam(1)).toBeUndefined();
    expect(pageSearchParam(2)).toBe(2);
    expect(pageSizeSearchParam(50)).toBeUndefined();
    expect(pageSizeSearchParam(200)).toBe(200);
  });

  it("builds the list query with defaults", () => {
    expect(bookingSearchToListQuery({})).toEqual({
      sort: { field: "date", direction: "desc" },
      page: 1,
      pageSize: 50,
    });
    expect(
      bookingSearchToListQuery({
        art: "ausgaben",
        sortierung: "kategorie-auf",
        seite: 2,
        proSeite: 25,
      }),
    ).toEqual({
      type: "expense",
      sort: { field: "category", direction: "asc" },
      page: 2,
      pageSize: 25,
    });
    expect(bookingSearchSort({})).toEqual({ field: "date", direction: "desc" });
    expect(bookingSearchPage({ seite: 7 })).toBe(7);
    expect(bookingSearchPageSize({ proSeite: 100 })).toBe(100);
    for (const size of BOOKING_PAGE_SIZES) {
      expect(normalizeBookingQuery({ pageSize: size }).ok).toBe(true);
    }
  });

  it("goes back to page 1 when filters, sort order or page size change", () => {
    const search: BookingSearch = { q: "a", sortierung: "brutto-auf", seite: 3 };
    expect(updateBookingSearch(search, { art: "ausgaben" })).toEqual({
      q: "a",
      art: "ausgaben",
      sortierung: "brutto-auf",
    });
    expect(updateBookingSearch(search, { sortierung: "netto-ab" })).toEqual({
      q: "a",
      sortierung: "netto-ab",
    });
    expect(updateBookingSearch(search, { proSeite: 100 })).toEqual({
      q: "a",
      sortierung: "brutto-auf",
      proSeite: 100,
    });
    // Page changes and patches that change nothing keep the page.
    expect(updateBookingSearch(search, { seite: 4 })).toEqual({ ...search, seite: 4 });
    expect(updateBookingSearch(search, { q: "a" })).toEqual(search);
    expect(updateBookingSearch(search, { seite: undefined })).toEqual({
      q: "a",
      sortierung: "brutto-auf",
    });
  });

  it("keeps sort order and page size when resetting the filters", () => {
    expect(
      resetBookingFilters({
        q: "a",
        art: "ausgaben",
        sortierung: "art-auf",
        seite: 4,
        proSeite: 25,
      }),
    ).toEqual({ sortierung: "art-auf", proSeite: 25 });
  });

  it("gives the shown rows of a page", () => {
    expect(pageRange(1, 50, 120)).toEqual({ from: 1, to: 50 });
    expect(pageRange(3, 50, 120)).toEqual({ from: 101, to: 120 });
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });
});
