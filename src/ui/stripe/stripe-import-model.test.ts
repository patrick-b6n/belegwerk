import { describe, expect, it } from "vitest";

import type { StripeImportResult } from "@/business/stripe";

import {
  berlinTodayIsoDate,
  checkImportFrom,
  checkImportTo,
  defaultImportPeriod,
  formatImportTimestamp,
  formatStripeAmount,
  importedBookingsSearch,
  importErrorsByField,
  stripeImportFormValues,
  stripeCurrencyDecimals,
  stripeImportSummary,
} from "./stripe-import-model";

const NEVER = { lastImportAt: null, lastImportTo: null };

describe("berlinTodayIsoDate", () => {
  it("is the calendar date in Europe/Berlin, not UTC", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Berlin (CET, UTC+1).
    expect(berlinTodayIsoDate(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(berlinTodayIsoDate(new Date("2026-07-14T21:59:59Z"))).toBe("2026-07-14");
    // CEST (UTC+2): 22:00 UTC is midnight.
    expect(berlinTodayIsoDate(new Date("2026-07-14T22:00:00Z"))).toBe("2026-07-15");
  });
});

describe("defaultImportPeriod", () => {
  it("starts on 1 January of the current year without a previous import", () => {
    expect(defaultImportPeriod(NEVER, "2026-11-14")).toEqual({
      from: "2026-01-01",
      to: "2026-11-14",
    });
  });

  it("starts on the last imported period end (that day again)", () => {
    expect(
      defaultImportPeriod(
        { lastImportAt: "2026-11-01T10:00:00.000Z", lastImportTo: "2026-11-01" },
        "2026-11-14",
      ),
    ).toEqual({ from: "2026-11-01", to: "2026-11-14" });
  });

  it("is today only when the last import was today", () => {
    expect(
      defaultImportPeriod({ lastImportAt: null, lastImportTo: "2026-11-14" }, "2026-11-14"),
    ).toEqual({ from: "2026-11-14", to: "2026-11-14" });
  });

  it("goes back to an earlier year", () => {
    expect(
      defaultImportPeriod({ lastImportAt: null, lastImportTo: "2025-12-20" }, "2026-01-05"),
    ).toEqual({ from: "2025-12-20", to: "2026-01-05" });
  });

  it("never starts after today (the clock went back)", () => {
    expect(
      defaultImportPeriod({ lastImportAt: null, lastImportTo: "2026-12-01" }, "2026-11-14"),
    ).toEqual({ from: "2026-11-14", to: "2026-11-14" });
  });
});

describe("stripeImportFormValues", () => {
  it("is the default period without confirmation", () => {
    expect(stripeImportFormValues(NEVER, "2026-11-14")).toEqual({
      from: "2026-01-01",
      to: "2026-11-14",
      confirmTestMode: false,
    });
  });
});

describe("checkImportFrom", () => {
  it.each([
    ["", "required"],
    ["  ", "required"],
    ["2026-02-30", "invalidDate"],
    ["14.11.2026", "invalidDate"],
  ] as const)("%j → %s", (value, code) => {
    expect(checkImportFrom(value)).toEqual({ field: "from", code });
  });

  it("accepts an existing date", () => {
    expect(checkImportFrom("2026-02-28")).toBeUndefined();
  });
});

describe("checkImportTo", () => {
  const today = "2026-11-14";

  it.each([
    ["", "2026-01-01", "required"],
    ["2026-13-01", "2026-01-01", "invalidDate"],
    ["2026-11-15", "2026-01-01", "inFuture"],
    // inFuture wins over beforeFrom, as in the service.
    ["2026-11-15", "2026-12-01", "inFuture"],
    ["2026-01-01", "2026-01-02", "beforeFrom"],
  ] as const)("to %j, from %j → %s", (to, from, code) => {
    expect(checkImportTo(to, from, today)).toEqual({ field: "to", code });
  });

  it.each([
    ["2026-11-14", "2026-01-01"],
    ["2026-01-01", "2026-01-01"],
    // An invalid `from` has its own error; `to` is not compared with it.
    ["2026-01-01", ""],
    ["2026-01-01", "2026-02-30"],
  ])("accepts to %j with from %j", (to, from) => {
    expect(checkImportTo(to, from, today)).toBeUndefined();
  });
});

describe("importErrorsByField", () => {
  it("keeps the first error per field", () => {
    const byField = importErrorsByField([
      { field: "to", code: "inFuture" },
      { field: "from", code: "required" },
      { field: "to", code: "beforeFrom" },
    ]);
    expect(byField.get("to")).toEqual({ field: "to", code: "inFuture" });
    expect(byField.get("from")).toEqual({ field: "from", code: "required" });
  });
});

describe("stripeCurrencyDecimals", () => {
  it.each([
    ["jpy", 0],
    ["krw", 0],
    ["eur", 2],
    ["huf", 2],
    ["isk", 2],
    ["idr", 2],
    ["kwd", 3],
    ["bhd", 3],
  ] as const)("%s → %i", (currency, digits) => {
    expect(stripeCurrencyDecimals(currency)).toBe(digits);
  });
});

describe("formatStripeAmount", () => {
  it("formats EUR cents like the rest of the app", () => {
    expect(formatStripeAmount(150, "eur")).toBe("1,50 €");
  });

  it("uses Stripe's decimals of other currencies, not CLDR's", () => {
    expect(formatStripeAmount(200, "usd")).toBe("2,00 $");
    expect(formatStripeAmount(500, "jpy")).toBe("500 ¥");
    // Zero decimals in CLDR, but ×100 in Stripe.
    expect(formatStripeAmount(10000, "huf")).toBe("100,00 HUF");
    expect(formatStripeAmount(12345, "isk")).toBe("123,45 ISK");
    // Three decimals.
    expect(formatStripeAmount(1500, "kwd")).toBe("1,500 KWD");
  });

  it("shows an unknown code as number and code", () => {
    expect(formatStripeAmount(42, "x1")).toBe("42 X1");
  });
});

describe("formatImportTimestamp", () => {
  it("shows date and time in Berlin time", () => {
    expect(formatImportTimestamp("2026-11-14T09:05:00.000Z")).toBe("14.11.2026, 10:05");
    expect(formatImportTimestamp("2026-07-14T22:30:00.000Z")).toBe("15.07.2026, 00:30");
  });

  it("returns an unreadable value as is", () => {
    expect(formatImportTimestamp("gestern")).toBe("gestern");
  });
});

describe("stripeImportSummary", () => {
  const result: Extract<StripeImportResult, { ok: true }> = {
    ok: true,
    range: { from: "2026-11-01", to: "2026-11-14" },
    keyMode: "test",
    created: 3,
    skipped: 2,
    failed: [
      {
        kind: "fee",
        externalId: "fee_1",
        date: "2026-11-02",
        amount: 200,
        currency: "usd",
        code: "unsupportedCurrency",
      },
      {
        kind: "refund",
        externalId: "fr_1",
        date: "2026-11-03",
        amount: 150,
        currency: "eur",
        code: "invalidBooking",
        errors: [{ field: "categoryId", code: "categoryArchived" }],
      },
    ],
    fees: { created: 2, skipped: 1, failed: 1 },
    refunds: { created: 1, skipped: 1, failed: 1 },
  };

  it("counts and lists the failures, formatted", () => {
    expect(stripeImportSummary(result)).toEqual({
      from: "2026-11-01",
      to: "2026-11-14",
      keyMode: "test",
      created: 3,
      skipped: 2,
      failed: 2,
      fees: { created: 2, skipped: 1, failed: 1 },
      refunds: { created: 1, skipped: 1, failed: 1 },
      failures: [
        {
          key: "fee_1",
          kind: "fee",
          externalId: "fee_1",
          date: "02.11.2026",
          amount: "2,00 $",
          code: "unsupportedCurrency",
          errors: [],
        },
        {
          key: "fr_1",
          kind: "refund",
          externalId: "fr_1",
          date: "03.11.2026",
          amount: "1,50 €",
          code: "invalidBooking",
          errors: [{ field: "categoryId", code: "categoryArchived" }],
        },
      ],
    });
  });

  it("has no failure rows for a clean import", () => {
    const summary = stripeImportSummary({ ...result, keyMode: "live", failed: [] });
    expect(summary.failed).toBe(0);
    expect(summary.failures).toEqual([]);
    expect(summary.keyMode).toBe("live");
  });
});

describe("importedBookingsSearch", () => {
  it("filters the list by the period and source Stripe", () => {
    expect(importedBookingsSearch({ from: "2026-11-01", to: "2026-11-14" })).toEqual({
      von: "2026-11-01",
      bis: "2026-11-14",
      quelle: "stripe",
    });
  });
});
