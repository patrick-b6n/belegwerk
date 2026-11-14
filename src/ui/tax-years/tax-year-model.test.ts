import { describe, expect, it } from "vitest";

import type { TaxYearOverview } from "@/business/tax-years";

import {
  checkYear,
  parseYear,
  sortYearsAscending,
  suggestedYear,
  yearError,
} from "./tax-year-model";

const overview = (year: number): TaxYearOverview => ({
  year,
  smallBusiness: false,
  explicit: true,
  mismatchedBookings: 0,
});

describe("sortYearsAscending", () => {
  it("puts the oldest year first without changing the input", () => {
    const years = [overview(2023), overview(2025), overview(2024)];
    expect(sortYearsAscending(years).map((y) => y.year)).toEqual([2023, 2024, 2025]);
    expect(years.map((y) => y.year)).toEqual([2023, 2025, 2024]);
  });
});

describe("suggestedYear", () => {
  it("suggests the current year if it is not listed", () => {
    expect(suggestedYear([], 2026)).toBe("2026");
    expect(suggestedYear([2024, 2027], 2026)).toBe("2026");
  });

  it("suggests the next year if the current one is listed", () => {
    expect(suggestedYear([2025, 2026], 2026)).toBe("2027");
  });

  it("suggests nothing if both are listed", () => {
    expect(suggestedYear([2026, 2027], 2026)).toBe("");
  });
});

describe("parseYear", () => {
  it("parses integers, ignoring surrounding whitespace", () => {
    expect(parseYear("2025")).toBe(2025);
    expect(parseYear(" 2025 ")).toBe(2025);
  });

  it("returns NaN for anything else", () => {
    for (const text of ["", "20 25", "2025.5", "2025,0", "-2025", "+2025", "1e3", "abc"]) {
      expect(parseYear(text)).toBeNaN();
    }
  });
});

describe("checkYear", () => {
  it("requires a value", () => {
    expect(checkYear("")).toBe("required");
    expect(checkYear("   ")).toBe("required");
  });

  it("accepts years in 1000–9999", () => {
    for (const text of ["1000", "2025", "9999"]) expect(checkYear(text)).toBeUndefined();
  });

  it("rejects other values", () => {
    for (const text of ["999", "10000", "0", "20x5", "2025.5"]) {
      expect(checkYear(text)).toBe("invalidYear");
    }
  });
});

describe("yearError", () => {
  it("returns the error of the year field", () => {
    expect(yearError([{ field: "year", code: "yearExists" }])).toEqual({
      field: "year",
      code: "yearExists",
    });
    expect(yearError([{ field: "smallBusiness", code: "invalidValue" }])).toBeUndefined();
    expect(yearError([])).toBeUndefined();
  });
});
