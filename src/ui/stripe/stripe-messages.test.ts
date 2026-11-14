import { describe, expect, it } from "vitest";

import type { StripeClientError } from "@/business/stripe";

import {
  importFailureReason,
  importFieldErrorMessage,
  importKindLabel,
  stripeClientErrorMessage,
  testConnectionMessage,
} from "./stripe-messages";

describe("stripeClientErrorMessage", () => {
  it("has a text for every client error", () => {
    const errors: StripeClientError[] = [
      { code: "invalidApiKey" },
      { code: "permissionDenied" },
      { code: "rateLimited", retryAfterSeconds: null },
      { code: "network" },
      { code: "timeout" },
      { code: "stripeError", status: 500, stripeCode: null, message: null },
      { code: "invalidResponse" },
    ];
    const texts = errors.map(stripeClientErrorMessage);
    expect(new Set(texts).size).toBe(errors.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(10);
  });

  it("names the wait, the HTTP status and Stripe's message", () => {
    expect(stripeClientErrorMessage({ code: "rateLimited", retryAfterSeconds: 30 })).toContain(
      "30 Sekunden",
    );
    expect(
      stripeClientErrorMessage({
        code: "stripeError",
        status: 400,
        stripeCode: "parameter_invalid_integer",
        message: "Invalid integer",
      }),
    ).toBe("Stripe meldet einen Fehler (HTTP 400): Invalid integer");
  });
});

describe("testConnectionMessage", () => {
  it("covers success, missing key and client errors", () => {
    expect(testConnectionMessage({ ok: true, livemode: null })).toContain("erfolgreich");
    expect(testConnectionMessage({ ok: false, reason: "noApiKey" })).toContain("Kein gültiger");
    expect(
      testConnectionMessage({ ok: false, reason: "stripe", error: { code: "permissionDenied" } }),
    ).toContain("Application fees");
  });
});

describe("importFieldErrorMessage", () => {
  it("has a distinct text for every period error", () => {
    const texts = (
      [
        { field: "from", code: "required" },
        { field: "to", code: "required" },
        { field: "to", code: "invalidDate" },
        { field: "to", code: "beforeFrom" },
        { field: "to", code: "inFuture" },
      ] as const
    ).map(importFieldErrorMessage);
    expect(new Set(texts).size).toBe(texts.length);
    expect(importFieldErrorMessage({ field: "from", code: "invalidDate" })).toBe(texts[2]);
  });
});

describe("importKindLabel", () => {
  it("names fees and refunds", () => {
    expect(importKindLabel("fee")).toBe("Fee");
    expect(importKindLabel("refund")).toBe("Rückerstattung");
  });
});

describe("importFailureReason", () => {
  it("has a text for every failure code", () => {
    const texts = (["unsupportedCurrency", "zeroAmount", "amountTooLarge"] as const).map((code) =>
      importFailureReason({ code, errors: [] }),
    );
    expect(new Set(texts).size).toBe(3);
  });

  it("lists the booking's field errors once each", () => {
    const text = importFailureReason({
      code: "invalidBooking",
      errors: [
        { field: "categoryId", code: "categoryArchived" },
        { field: "categoryId", code: "categoryArchived" },
        { field: "vatRate", code: "vatRateRequired" },
      ],
    });
    expect(text).toMatch(/^Buchung ungültig: /);
    expect(text.match(/archiviert/g)).toHaveLength(1);
  });
});
