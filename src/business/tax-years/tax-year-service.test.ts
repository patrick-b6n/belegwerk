import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import { createBookingService } from "../bookings";
import type { BookingInput, VatRate } from "../model";
import type { UnitOfWork } from "../repositories";
import { createTaxYearService, isTaxYear } from "./tax-year-service";

async function setup() {
  const { repositories, unitOfWork } = createInMemoryDatabase();
  const category = await repositories.categories.insert({
    name: "Umsatzerlöse",
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
    isSystem: false,
  });
  /** Inserts a booking directly (any rate, regardless of the year's status). */
  const addBooking = (date: string, vatRate: VatRate | null) => {
    const input: BookingInput = {
      date,
      type: "income",
      grossCents: 11900,
      vatRate,
      netCents: vatRate === "19" ? 10000 : 11900,
      vatCents: vatRate === "19" ? 1900 : 0,
      categoryId: category.id,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "manual",
      externalId: null,
    };
    return repositories.bookings.insert(input);
  };
  const service = createTaxYearService({ unitOfWork });
  return { repositories, unitOfWork, service, addBooking, category };
}

const regular = (year: number, explicit: boolean) => ({ year, smallBusiness: false, explicit });
const smallBusiness = (year: number) => ({ year, smallBusiness: true, explicit: true });
const invalidYear = {
  ok: false,
  reason: "invalid",
  errors: [{ field: "year", code: "invalidYear" }],
};

describe("isTaxYear", () => {
  it("accepts integers in 1000–9999 only", () => {
    for (const year of [1000, 2025, 9999]) expect(isTaxYear(year)).toBe(true);
    for (const year of [999, 10000, 2025.5, Number.NaN, Infinity, -2025, 0]) {
      expect(isTaxYear(year)).toBe(false);
    }
  });
});

describe("TaxYearService.get", () => {
  it("defaults to regularly taxed without a record", async () => {
    const { service } = await setup();
    expect(await service.get(2025)).toEqual({ ok: true, taxYear: regular(2025, false) });
  });

  it("returns the recorded status", async () => {
    const { service, repositories } = await setup();
    await repositories.taxYears.upsert({ year: 2024, smallBusiness: true });
    await repositories.taxYears.upsert({ year: 2025, smallBusiness: false });
    expect(await service.get(2024)).toEqual({ ok: true, taxYear: smallBusiness(2024) });
    expect(await service.get(2025)).toEqual({ ok: true, taxYear: regular(2025, true) });
  });

  it("rejects invalid years without touching the store", async () => {
    const { service } = await setup();
    for (const year of [999, 10000, 2025.5, Number.NaN]) {
      expect(await service.get(year)).toEqual(invalidYear);
    }
  });
});

describe("TaxYearService.list", () => {
  it("is empty without records and bookings", async () => {
    const { service } = await setup();
    expect(await service.list()).toEqual([]);
  });

  it("merges recorded years and years with bookings, ascending", async () => {
    const { service, repositories, addBooking } = await setup();
    await repositories.taxYears.upsert({ year: 2026, smallBusiness: false });
    await repositories.taxYears.upsert({ year: 2023, smallBusiness: true });
    await addBooking("2024-05-01", "19");
    await addBooking("2024-06-01", "7");
    await addBooking("2023-01-01", null);

    expect(await service.list()).toEqual([
      { ...smallBusiness(2023), mismatchedBookings: 0 },
      { ...regular(2024, false), mismatchedBookings: 0 },
      { ...regular(2026, true), mismatchedBookings: 0 },
    ]);
  });

  it("counts the bookings whose VAT rate does not fit the year's status", async () => {
    const { service, repositories, addBooking } = await setup();
    await repositories.taxYears.upsert({ year: 2023, smallBusiness: true });
    await addBooking("2023-02-01", "19");
    await addBooking("2023-03-01", "7");
    await addBooking("2023-04-01", null);
    await addBooking("2024-05-01", null);
    await addBooking("2024-06-01", "19");
    await addBooking("2025-01-01", "19");

    expect(await service.list()).toEqual([
      { ...smallBusiness(2023), mismatchedBookings: 2 },
      { ...regular(2024, false), mismatchedBookings: 1 },
      { ...regular(2025, false), mismatchedBookings: 0 },
    ]);
  });

  it("counts only for years with bookings, in one unit of work", async () => {
    const { repositories, unitOfWork, addBooking } = await setup();
    await repositories.taxYears.upsert({ year: 2026, smallBusiness: true });
    await addBooking("2024-05-01", "19");
    let runs = 0;
    const counted: number[] = [];
    const counting: UnitOfWork = {
      run: (work) => {
        runs += 1;
        return unitOfWork.run((repos) =>
          work({
            ...repos,
            bookings: {
              ...repos.bookings,
              countVatRateUsage: (year) => {
                counted.push(year);
                return repos.bookings.countVatRateUsage(year);
              },
            },
          }),
        );
      },
    };
    await createTaxYearService({ unitOfWork: counting }).list();
    expect(runs).toBe(1);
    expect(counted).toEqual([2024]);
  });
});

describe("TaxYearService.addYear", () => {
  it("records the year as regularly taxed", async () => {
    const { service, repositories } = await setup();
    expect(await service.addYear(2027)).toEqual({ ok: true, taxYear: regular(2027, true) });
    expect(await repositories.taxYears.find(2027)).toEqual({ year: 2027, smallBusiness: false });
  });

  it("records a year that so far only has bookings", async () => {
    const { service, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    expect(await service.addYear(2025)).toEqual({ ok: true, taxYear: regular(2025, true) });
  });

  it("reports an already recorded year and keeps its status", async () => {
    const { service, repositories } = await setup();
    await repositories.taxYears.upsert({ year: 2025, smallBusiness: true });
    expect(await service.addYear(2025)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "year", code: "yearExists" }],
    });
    expect(await repositories.taxYears.find(2025)).toEqual({ year: 2025, smallBusiness: true });
  });

  it("rejects invalid years", async () => {
    const { service, repositories } = await setup();
    for (const year of [999, 10000, 2025.5, Number.NaN]) {
      expect(await service.addYear(year)).toEqual(invalidYear);
    }
    expect(await repositories.taxYears.list()).toEqual([]);
  });
});

describe("TaxYearService.setSmallBusiness", () => {
  it("sets and resets the status of a year without bookings", async () => {
    const { service, repositories } = await setup();
    expect(await service.setSmallBusiness(2025, true)).toEqual({
      ok: true,
      taxYear: smallBusiness(2025),
      mismatchedBookings: 0,
    });
    expect(await service.get(2025)).toEqual({ ok: true, taxYear: smallBusiness(2025) });
    expect(await service.setSmallBusiness(2025, false)).toEqual({
      ok: true,
      taxYear: regular(2025, true),
      mismatchedBookings: 0,
    });
    expect(await repositories.taxYears.list()).toEqual([{ year: 2025, smallBusiness: false }]);
  });

  it("records the default status explicitly", async () => {
    const { service, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    expect(await service.setSmallBusiness(2025, false)).toEqual({
      ok: true,
      taxYear: regular(2025, true),
      mismatchedBookings: 0,
    });
  });

  it("switches without conflict when all bookings already fit", async () => {
    const { service, addBooking } = await setup();
    // Bookings without a rate in a regular year cannot be created through the
    // booking service, but switching them to small business makes them fit.
    await addBooking("2025-01-01", null);
    expect(await service.setSmallBusiness(2025, true)).toMatchObject({
      ok: true,
      mismatchedBookings: 0,
    });
  });

  it("refuses switching to small business while bookings have a VAT rate", async () => {
    const { service, repositories, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    await addBooking("2025-12-31", "0");
    await addBooking("2025-06-01", null);
    await addBooking("2024-06-01", "19"); // other year

    expect(await service.setSmallBusiness(2025, true)).toEqual({
      ok: false,
      reason: "conflicts",
      mismatchedBookings: 2,
    });
    expect(await repositories.taxYears.find(2025)).toBeUndefined();
  });

  it("refuses switching to regular while bookings have no VAT rate", async () => {
    const { service, repositories, addBooking } = await setup();
    await repositories.taxYears.upsert({ year: 2024, smallBusiness: true });
    await addBooking("2024-01-01", null);
    await addBooking("2024-02-01", null);
    await addBooking("2024-03-01", "7");

    expect(await service.setSmallBusiness(2024, false)).toEqual({
      ok: false,
      reason: "conflicts",
      mismatchedBookings: 2,
    });
    expect(await repositories.taxYears.find(2024)).toEqual({ year: 2024, smallBusiness: true });
  });

  it("changes the status when the conflicts are acknowledged, without touching bookings", async () => {
    const { service, repositories, addBooking } = await setup();
    const booking = await addBooking("2025-01-01", "19");

    expect(await service.setSmallBusiness(2025, true, { acknowledgeConflicts: true })).toEqual({
      ok: true,
      taxYear: smallBusiness(2025),
      mismatchedBookings: 1,
    });
    expect(await repositories.bookings.findById(booking.id)).toEqual(booking);
  });

  it("only counts `true` as acknowledgement", async () => {
    const { service, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    for (const acknowledgeConflicts of [false, undefined, "yes" as unknown as boolean]) {
      expect(await service.setSmallBusiness(2025, true, { acknowledgeConflicts })).toMatchObject({
        ok: false,
        reason: "conflicts",
      });
    }
  });

  it("does not report conflicts when the status stays the same, but counts mismatches", async () => {
    const { service, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    await service.setSmallBusiness(2025, true, { acknowledgeConflicts: true });
    expect(await service.setSmallBusiness(2025, true)).toEqual({
      ok: true,
      taxYear: smallBusiness(2025),
      mismatchedBookings: 1,
    });
  });

  it("validates year and value at runtime and reports all errors", async () => {
    const { service, repositories } = await setup();
    expect(await service.setSmallBusiness(Number.NaN, 1 as unknown as boolean)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "year", code: "invalidYear" },
        { field: "smallBusiness", code: "invalidValue" },
      ],
    });
    expect(await service.setSmallBusiness(2025, "true" as unknown as boolean)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "smallBusiness", code: "invalidValue" }],
    });
    expect(await service.setSmallBusiness(10000, true)).toEqual(invalidYear);
    expect(await repositories.taxYears.list()).toEqual([]);
  });

  it("checks and writes in one unit of work", async () => {
    const { repositories, unitOfWork, addBooking } = await setup();
    await addBooking("2025-01-01", "19");
    let runs = 0;
    const counting: UnitOfWork = {
      run: (fn) => {
        runs += 1;
        return unitOfWork.run(fn);
      },
    };
    const service = createTaxYearService({ unitOfWork: counting });
    await service.setSmallBusiness(2025, true, { acknowledgeConflicts: true });
    expect(runs).toBe(1);
    expect(await repositories.taxYears.find(2025)).toEqual({ year: 2025, smallBusiness: true });
  });
});

describe("TaxYearService with the booking service", () => {
  it("bookings follow the new status; mismatched ones need a fitting rate on edit", async () => {
    const { unitOfWork, service, category } = await setup();
    const bookings = createBookingService({ unitOfWork });
    const input = (vatRate: VatRate | null) => ({
      date: "2025-03-01",
      type: "income" as const,
      grossCents: 11900,
      vatRate,
      categoryId: category.id,
      description: "Beratung",
      counterparty: "Kunde",
      reference: null,
      note: null,
    });
    const created = await bookings.create(input("19"));
    if (!created.ok) throw new Error("create failed");

    await service.setSmallBusiness(2025, true, { acknowledgeConflicts: true });

    expect(await bookings.create(input("19"))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "vatRate", code: "vatRateNotAllowed" }],
    });
    expect(await bookings.create(input(null))).toMatchObject({ ok: true });
    // The mismatched booking stays loadable; saving it unchanged fails, without a rate works.
    expect(await bookings.get(created.booking.id)).toEqual(created);
    expect(await bookings.update(created.booking.id, input("19"))).toMatchObject({
      ok: false,
      errors: [{ field: "vatRate", code: "vatRateNotAllowed" }],
    });
    expect(await bookings.update(created.booking.id, input(null))).toMatchObject({
      ok: true,
      booking: { vatRate: null, netCents: 11900, vatCents: 0 },
    });
  });
});
