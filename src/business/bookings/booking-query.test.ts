import { describe, expect, it } from "vitest";

import type { BookingSort } from "../repositories";
import {
  BOOKING_SEARCH_TEXT_MAX_LENGTH,
  BOOKING_SORT_FIELDS,
  type BookingQuery,
  DEFAULT_BOOKING_PAGE_SIZE,
  MAX_BOOKING_PAGE_SIZE,
  MAX_BOOKING_QUERY_CATEGORY_IDS,
  normalizeBookingQuery,
} from "./booking-query";
import { textSearchCharClasses } from "./text-search";

function normalized(query?: BookingQuery) {
  const result = normalizeBookingQuery(query);
  if (!result.ok) throw new Error(`Expected a valid query, got ${JSON.stringify(result)}`);
  return result.query;
}

function errorsOf(query: BookingQuery) {
  const result = normalizeBookingQuery(query);
  if (result.ok) throw new Error("Expected errors");
  return result.errors;
}

describe("normalizeBookingQuery", () => {
  it("applies the defaults to an empty query", () => {
    const expected = {
      filter: {},
      sort: { field: "date", direction: "desc" },
      page: 1,
      pageSize: DEFAULT_BOOKING_PAGE_SIZE,
    };
    expect(normalized()).toEqual(expected);
    expect(normalized({})).toEqual(expected);
  });

  it("keeps a complete valid query", () => {
    expect(
      normalized({
        text: "Müller",
        dateFrom: "2025-01-01",
        dateTo: "2025-12-31",
        type: "expense",
        categoryIds: [3, 1, 3],
        source: "stripe",
        vatRates: ["19", null, "19"],
        amountFrom: 0,
        amountTo: 10_000,
        sort: { field: "category", direction: "asc" },
        page: 4,
        pageSize: MAX_BOOKING_PAGE_SIZE,
      }),
    ).toEqual({
      filter: {
        text: "Müller",
        dateFrom: "2025-01-01",
        dateTo: "2025-12-31",
        type: "expense",
        categoryIds: [3, 1],
        source: "stripe",
        vatRates: ["19", null],
        amountFrom: 0,
        amountTo: 10_000,
      },
      sort: { field: "category", direction: "asc" },
      page: 4,
      pageSize: MAX_BOOKING_PAGE_SIZE,
    });
  });

  it("trims and NFC-normalizes the text; blank text does not filter", () => {
    expect(normalized({ text: " ​ Müller \n" }).filter).toEqual({ text: "Müller" });
    expect(normalized({ text: "  a  b " }).filter).toEqual({ text: "a  b" });
    expect(normalized({ text: " ​\t" }).filter).toEqual({});
    expect(
      normalized({ text: "x".repeat(BOOKING_SEARCH_TEXT_MAX_LENGTH) }).filter.text,
    ).toHaveLength(BOOKING_SEARCH_TEXT_MAX_LENGTH);
    expect(errorsOf({ text: "x".repeat(BOOKING_SEARCH_TEXT_MAX_LENGTH + 1) })).toEqual([
      { field: "text", code: "tooLong" },
    ]);
  });

  it("rejects control characters and lone surrogates in the text", () => {
    const invalid = [
      "a\u0000b",
      "\u0000",
      "Rate\nfür",
      "a\tb",
      "a\u007fb",
      "a\ud800b",
      "a\udc00",
      "\ud83d",
    ];
    for (const text of invalid) {
      expect(errorsOf({ text })).toEqual([{ field: "text", code: "invalidText" }]);
    }
    // Trimmed at the ends first; surrogate pairs are fine.
    expect(normalized({ text: "\n\tMüller\r\n" }).filter).toEqual({ text: "Müller" });
    expect(normalized({ text: "😀 𐐀" }).filter).toEqual({ text: "😀 𐐀" });
  });

  it("validates the period; blank dates do not filter", () => {
    expect(normalized({ dateFrom: " ", dateTo: "" }).filter).toEqual({});
    expect(normalized({ dateFrom: " 2025-03-01 " }).filter).toEqual({ dateFrom: "2025-03-01" });
    expect(normalized({ dateFrom: "2025-03-01", dateTo: "2025-03-01" }).filter).toEqual({
      dateFrom: "2025-03-01",
      dateTo: "2025-03-01",
    });
    expect(errorsOf({ dateFrom: "2025-02-30", dateTo: "01.03.2025" })).toEqual([
      { field: "dateFrom", code: "invalidDate" },
      { field: "dateTo", code: "invalidDate" },
    ]);
    expect(errorsOf({ dateFrom: "2025-03-02", dateTo: "2025-03-01" })).toEqual([
      { field: "dateTo", code: "dateRangeInverted" },
    ]);
    // An invalid "from" does not make "to" an inverted range.
    expect(errorsOf({ dateFrom: "0999-12-31", dateTo: "2025-01-01" })).toEqual([
      { field: "dateFrom", code: "invalidDate" },
    ]);
  });

  it("validates type, categories and source", () => {
    expect(normalized({ categoryIds: [] }).filter).toEqual({});
    expect(
      errorsOf({
        type: "transfer" as never,
        categoryIds: [1, Number.NaN],
        source: "bank" as never,
      }),
    ).toEqual([
      { field: "type", code: "invalidType" },
      { field: "categoryIds", code: "invalidCategoryId" },
      { field: "source", code: "invalidSource" },
    ]);
    const many = Array.from({ length: MAX_BOOKING_QUERY_CATEGORY_IDS }, (_, index) => index + 1);
    expect(normalized({ categoryIds: [...many, ...many] }).filter.categoryIds).toEqual(many);
    expect(errorsOf({ categoryIds: [...many, 4711] })).toEqual([
      { field: "categoryIds", code: "tooMany" },
    ]);
    for (const id of [0, -1, 1.5, Infinity]) {
      expect(errorsOf({ categoryIds: [id] })).toEqual([
        { field: "categoryIds", code: "invalidCategoryId" },
      ]);
    }
  });

  it("validates the VAT rates; null means no rate, an empty list does not filter", () => {
    expect(normalized({ vatRates: [] }).filter).toEqual({});
    expect(normalized({ vatRates: [null, "0", "7", "19", "reverse_charge", null] }).filter).toEqual(
      { vatRates: [null, "0", "7", "19", "reverse_charge"] },
    );
    for (const rate of ["16", "", "ohne", 19, undefined]) {
      expect(errorsOf({ vatRates: ["19", rate as never] })).toEqual([
        { field: "vatRates", code: "invalidVatRate" },
      ]);
    }
  });

  it("validates the amount range", () => {
    expect(normalized({ amountFrom: 500, amountTo: 500 }).filter).toEqual({
      amountFrom: 500,
      amountTo: 500,
    });
    for (const amount of [-1, 1.5, Number.NaN, Infinity, 2 ** 53]) {
      expect(errorsOf({ amountFrom: amount, amountTo: amount })).toEqual([
        { field: "amountFrom", code: "invalidAmount" },
        { field: "amountTo", code: "invalidAmount" },
      ]);
    }
    expect(errorsOf({ amountFrom: 501, amountTo: 500 })).toEqual([
      { field: "amountTo", code: "amountRangeInverted" },
    ]);
  });

  it("accepts every sort field and direction, rejects others", () => {
    for (const field of BOOKING_SORT_FIELDS) {
      for (const direction of ["asc", "desc"] as const) {
        expect(normalized({ sort: { field, direction } }).sort).toEqual({ field, direction });
      }
    }
    expect(BOOKING_SORT_FIELDS).toHaveLength(9);
    const invalid: unknown[] = [
      { field: "id", direction: "asc" },
      { field: "toString", direction: "asc" },
      { field: "date", direction: "up" },
    ];
    for (const sort of invalid) {
      expect(errorsOf({ sort: sort as BookingSort })).toEqual([
        { field: "sort", code: "invalidSort" },
      ]);
    }
  });

  it("validates page and page size", () => {
    expect(normalized({ pageSize: "all" }).pageSize).toBe("all");
    expect(normalized({ page: 2, pageSize: 1 })).toMatchObject({ page: 2, pageSize: 1 });
    for (const page of [0, -1, 1.5, Number.NaN]) {
      expect(errorsOf({ page })).toEqual([{ field: "page", code: "invalidPage" }]);
    }
    for (const pageSize of [0, MAX_BOOKING_PAGE_SIZE + 1, 2.5, Number.NaN]) {
      expect(errorsOf({ pageSize })).toEqual([{ field: "pageSize", code: "invalidPageSize" }]);
    }
  });
});

describe("textSearchCharClasses", () => {
  it("returns the case variants of each character, the character first", () => {
    expect(textSearchCharClasses("Mü%1")).toEqual([["M", "m"], ["ü", "Ü"], ["%"], ["1"]]);
    expect(textSearchCharClasses("ß")).toEqual([["ß", "ẞ"]]);
    expect(textSearchCharClasses("ẞ")).toEqual([["ẞ", "ß"]]);
    expect(textSearchCharClasses("ς")).toEqual([["ς", "Σ", "σ"]]);
    // Multi-character mappings are dropped (İ → i̇).
    expect(textSearchCharClasses("İ")).toEqual([["İ"]]);
    // Code points, not UTF-16 units.
    expect(textSearchCharClasses("😀𐐀")).toEqual([["😀"], ["𐐀", "𐐨"]]);
  });
});
