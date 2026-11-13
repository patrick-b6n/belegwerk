import { describe, expect, it } from "vitest";

import { formatDate } from "./date";

describe("formatDate", () => {
  it("runs in a non-UTC time zone (see vitest.config.ts)", () => {
    // Guards the TZ setup: if this ran in UTC, the tests below could not
    // catch accidental local-time formatting.
    expect(new Date(Date.UTC(2025, 2, 7)).getTimezoneOffset()).not.toBe(0);
  });

  it.each([
    ["2025-03-07", "07.03.2025"],
    ["2025-12-31", "31.12.2025"],
    ["2026-01-01", "01.01.2026"],
    ["2024-02-29", "29.02.2024"],
    ["1000-01-01", "01.01.1000"],
    ["9999-12-31", "31.12.9999"],
  ])("formats ISO date %j as %j regardless of the local time zone", (iso, expected) => {
    expect(formatDate(iso)).toBe(expected);
  });

  it.each(["2025-02-29", "2025-02-30", "2025-13-01", "2025-00-10", "2025-01-00"])(
    "rejects non-existent date %j",
    (iso) => {
      expect(() => formatDate(iso)).toThrow(RangeError);
    },
  );

  it.each(["0000-01-01", "0099-01-01", "0999-12-31"])("rejects year below 1000 in %j", (iso) => {
    expect(() => formatDate(iso)).toThrow(RangeError);
  });

  it.each(["", "07.03.2025", "2025-3-7", "2025-03-07T10:00:00Z", "12025-01-01", "garbage"])(
    "rejects malformed input %j",
    (input) => {
      expect(() => formatDate(input)).toThrow(RangeError);
    },
  );
});
