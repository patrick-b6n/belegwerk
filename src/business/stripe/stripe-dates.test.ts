import { describe, expect, it } from "vitest";

import {
  berlinStartOfDay,
  bookingDateRangeToStripeCreated,
  stripeCreatedToBookingDate,
  subtractDays,
} from "./stripe-dates";

const epoch = (iso: string) => Date.parse(iso) / 1000;

describe("stripeCreatedToBookingDate", () => {
  it("uses the calendar date in Europe/Berlin, also across the year boundary", () => {
    expect(stripeCreatedToBookingDate(epoch("2024-12-31T22:59:59Z"))).toBe("2024-12-31");
    expect(stripeCreatedToBookingDate(epoch("2024-12-31T23:00:00Z"))).toBe("2025-01-01");
    expect(stripeCreatedToBookingDate(epoch("2025-03-07T12:00:00Z"))).toBe("2025-03-07");
  });

  it("uses summer time (UTC+2) between the DST switches", () => {
    expect(stripeCreatedToBookingDate(epoch("2025-06-30T21:59:59Z"))).toBe("2025-06-30");
    expect(stripeCreatedToBookingDate(epoch("2025-06-30T22:00:00Z"))).toBe("2025-07-01");
  });

  it("handles the DST switch days", () => {
    // 30 Mar 2025: 02:00 CET → 03:00 CEST (01:00 UTC).
    expect(stripeCreatedToBookingDate(epoch("2025-03-29T22:59:59Z"))).toBe("2025-03-29");
    expect(stripeCreatedToBookingDate(epoch("2025-03-29T23:00:00Z"))).toBe("2025-03-30");
    expect(stripeCreatedToBookingDate(epoch("2025-03-30T21:59:59Z"))).toBe("2025-03-30");
    expect(stripeCreatedToBookingDate(epoch("2025-03-30T22:00:00Z"))).toBe("2025-03-31");
    // 26 Oct 2025: 03:00 CEST → 02:00 CET (01:00 UTC).
    expect(stripeCreatedToBookingDate(epoch("2025-10-25T21:59:59Z"))).toBe("2025-10-25");
    expect(stripeCreatedToBookingDate(epoch("2025-10-25T22:00:00Z"))).toBe("2025-10-26");
    expect(stripeCreatedToBookingDate(epoch("2025-10-26T22:59:59Z"))).toBe("2025-10-26");
    expect(stripeCreatedToBookingDate(epoch("2025-10-26T23:00:00Z"))).toBe("2025-10-27");
  });

  it("rejects non-integer timestamps", () => {
    expect(() => stripeCreatedToBookingDate(1.5)).toThrow(RangeError);
    expect(() => stripeCreatedToBookingDate(Number.NaN)).toThrow(RangeError);
  });
});

describe("berlinStartOfDay", () => {
  it("is 00:00 Berlin time in winter and summer and on switch days", () => {
    expect(berlinStartOfDay("2025-01-01")).toBe(epoch("2024-12-31T23:00:00Z"));
    expect(berlinStartOfDay("2025-07-01")).toBe(epoch("2025-06-30T22:00:00Z"));
    expect(berlinStartOfDay("2025-03-30")).toBe(epoch("2025-03-29T23:00:00Z"));
    expect(berlinStartOfDay("2025-03-31")).toBe(epoch("2025-03-30T22:00:00Z"));
    expect(berlinStartOfDay("2025-10-26")).toBe(epoch("2025-10-25T22:00:00Z"));
    expect(berlinStartOfDay("2025-10-27")).toBe(epoch("2025-10-26T23:00:00Z"));
  });

  it("rejects invalid dates", () => {
    expect(() => berlinStartOfDay("2025-02-30")).toThrow(RangeError);
    expect(() => berlinStartOfDay("07.03.2025")).toThrow(RangeError);
  });
});

describe("bookingDateRangeToStripeCreated", () => {
  it("covers the whole German calendar days inclusively", () => {
    expect(bookingDateRangeToStripeCreated("2025-01-01", "2025-12-31")).toEqual({
      createdFrom: epoch("2024-12-31T23:00:00Z"),
      createdTo: epoch("2025-12-31T22:59:59Z"),
    });
    // Short (23 h) and long (25 h) days.
    expect(bookingDateRangeToStripeCreated("2025-03-30", "2025-03-30")).toEqual({
      createdFrom: epoch("2025-03-29T23:00:00Z"),
      createdTo: epoch("2025-03-30T21:59:59Z"),
    });
    expect(bookingDateRangeToStripeCreated("2025-10-26", "2025-10-26")).toEqual({
      createdFrom: epoch("2025-10-25T22:00:00Z"),
      createdTo: epoch("2025-10-26T22:59:59Z"),
    });
  });

  it("round-trips with stripeCreatedToBookingDate at the bounds", () => {
    const { createdFrom, createdTo } = bookingDateRangeToStripeCreated("2025-02-28", "2025-03-30");
    expect(stripeCreatedToBookingDate(createdFrom)).toBe("2025-02-28");
    expect(stripeCreatedToBookingDate(createdFrom - 1)).toBe("2025-02-27");
    expect(stripeCreatedToBookingDate(createdTo)).toBe("2025-03-30");
    expect(stripeCreatedToBookingDate(createdTo + 1)).toBe("2025-03-31");
  });

  it("rejects invalid or reversed ranges", () => {
    expect(() => bookingDateRangeToStripeCreated("2025-03-02", "2025-03-01")).toThrow(RangeError);
    expect(() => bookingDateRangeToStripeCreated("2025-03-01", "2025-13-01")).toThrow(RangeError);
  });
});

describe("subtractDays", () => {
  it("subtracts whole days of seconds", () => {
    expect(subtractDays(epoch("2025-07-01T00:00:00Z"), 180)).toBe(epoch("2025-01-02T00:00:00Z"));
  });
});
