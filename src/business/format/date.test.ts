import { describe, expect, it } from "vitest";

import { formatDate } from "./date";

describe("formatDate", () => {
  it.each([
    ["2025-03-07", "07.03.2025"],
    ["2025-12-31", "31.12.2025"],
    ["2026-01-01", "01.01.2026"],
    ["2024-02-29", "29.02.2024"],
    ["1000-01-01", "01.01.1000"],
    ["9999-12-31", "31.12.9999"],
  ])("formats ISO date %j as %j", (iso, expected) => {
    expect(formatDate(iso)).toBe(expected);
  });

  it("formats a Date in local time", () => {
    expect(formatDate(new Date(2025, 0, 5))).toBe("05.01.2025");
    expect(formatDate(new Date(2025, 11, 31, 23, 59, 59))).toBe("31.12.2025");
  });

  it.each(["2025-02-29", "2025-02-30", "2025-13-01", "2025-00-10", "2025-01-00"])(
    "rejects non-existent date %j",
    (iso) => {
      expect(() => formatDate(iso)).toThrow(RangeError);
    },
  );

  it.each(["", "07.03.2025", "2025-3-7", "2025-03-07T10:00:00Z", "garbage"])(
    "rejects malformed input %j",
    (input) => {
      expect(() => formatDate(input)).toThrow(RangeError);
    },
  );

  it.each(["0000-01-01", "0099-01-01", "0999-12-31"])("rejects year below 1000 in %j", (iso) => {
    expect(() => formatDate(iso)).toThrow(RangeError);
  });

  it("rejects a Date with a year outside 1000–9999", () => {
    const date = new Date(2025, 0, 1);
    date.setFullYear(99);
    expect(() => formatDate(date)).toThrow(RangeError);
  });

  it("rejects an invalid Date", () => {
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
