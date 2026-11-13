import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import type { Booking, BookingType } from "../model";
import type { Repositories, UnitOfWork } from "../repositories";
import { ConstraintViolationError } from "../repositories";
import {
  BOOKING_TEXT_MAX_LENGTH,
  type BookingFieldError,
  type BookingFormInput,
  createBookingService,
} from "./booking-service";

const NOW = new Date("2025-03-07T12:34:56.789Z");

async function setup() {
  let now = NOW;
  const { repositories, unitOfWork } = createInMemoryDatabase({ clock: () => now });
  const setNow = (date: Date) => {
    now = date;
  };
  const addCategory = async (type: BookingType, name: string, archived = false) => {
    const category = await repositories.categories.insert({
      name,
      type,
      euerPosition: type === "income" ? "BETRIEBSEINNAHMEN_UST_PFLICHTIG" : "TELEKOMMUNIKATION",
      reducesIncome: false,
      isSystem: false,
    });
    return archived ? (await repositories.categories.setArchived(category.id, true))! : category;
  };
  const income = await addCategory("income", "Umsatzerlöse");
  const expense = await addCategory("expense", "Telefon");
  const archivedIncome = await addCategory("income", "Alt", true);
  // 2024: small business; 2025: explicitly regularly taxed; 2026: no record.
  await repositories.taxYears.upsert({ year: 2024, smallBusiness: true });
  await repositories.taxYears.upsert({ year: 2025, smallBusiness: false });
  const service = createBookingService({ unitOfWork });
  const input = (overrides: Partial<BookingFormInput> = {}): BookingFormInput => ({
    date: "2025-03-01",
    type: "income",
    grossCents: 11900,
    vatRate: "19",
    categoryId: income.id,
    description: "Beratung",
    counterparty: "Kunde GmbH",
    ...overrides,
  });
  const create = async (overrides: Partial<BookingFormInput> = {}): Promise<Booking> => {
    const result = await service.create(input(overrides));
    if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`);
    return result.booking;
  };
  return {
    repositories,
    service,
    input,
    create,
    income,
    expense,
    archivedIncome,
    addCategory,
    setNow,
  };
}

function errorsOf(result: { ok: boolean }): readonly BookingFieldError[] {
  if (result.ok || !("errors" in result)) {
    throw new Error(`Expected validation errors, got ${JSON.stringify(result)}`);
  }
  return result.errors as readonly BookingFieldError[];
}

describe("BookingService.create", () => {
  it("saves a booking with computed net and VAT and defaults", async () => {
    const { service, input, income, repositories } = await setup();
    const result = await service.create(input());
    expect(result).toEqual({
      ok: true,
      booking: {
        id: expect.any(Number),
        date: "2025-03-01",
        type: "income",
        grossCents: 11900,
        vatRate: "19",
        netCents: 10000,
        vatCents: 1900,
        categoryId: income.id,
        description: "Beratung",
        counterparty: "Kunde GmbH",
        reference: null,
        note: null,
        source: "manual",
        externalId: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    });
    if (!result.ok) return;
    expect(await repositories.bookings.findById(result.booking.id)).toEqual(result.booking);
  });

  it("ignores net and VAT passed by a caller", async () => {
    const { create } = await setup();
    const sneaky = { netCents: 1, vatCents: 11899 } as Partial<BookingFormInput>;
    const booking = await create(sneaky);
    expect([booking.netCents, booking.vatCents]).toEqual([10000, 1900]);
  });

  it.each([
    ["7", 10700, 10000, 700],
    ["0", 10000, 10000, 0],
    ["reverse_charge", 10000, 10000, 0],
  ] as const)("computes VAT rate %s", async (vatRate, grossCents, netCents, vatCents) => {
    const { create } = await setup();
    const booking = await create({ vatRate, grossCents });
    expect([booking.netCents, booking.vatCents]).toEqual([netCents, vatCents]);
  });

  it("requires no VAT rate in a small business year (net = gross)", async () => {
    const { create } = await setup();
    const booking = await create({ date: "2024-06-30", vatRate: null });
    expect(booking).toMatchObject({ vatRate: null, netCents: 11900, vatCents: 0 });
  });

  it("rejects a VAT rate in a small business year", async () => {
    const { service, input } = await setup();
    expect(errorsOf(await service.create(input({ date: "2024-06-30" })))).toEqual([
      { field: "vatRate", code: "vatRateNotAllowed" },
    ]);
  });

  it.each(["2025-03-01", "2026-01-01"])(
    "requires a VAT rate in a regularly taxed year (%s; 2026 has no record)",
    async (date) => {
      const { service, input } = await setup();
      expect(errorsOf(await service.create(input({ date, vatRate: null })))).toEqual([
        { field: "vatRate", code: "vatRateRequired" },
      ]);
    },
  );

  it("decides the VAT rule by the year of the date at the year boundary", async () => {
    const { service, input } = await setup();
    expect((await service.create(input({ date: "2024-12-31", vatRate: null }))).ok).toBe(true);
    expect((await service.create(input({ date: "2025-01-01", vatRate: null }))).ok).toBe(false);
  });

  it("trims texts, keeps inner whitespace and turns blank optional texts into null", async () => {
    const { create } = await setup();
    const booking = await create({
      date: " 2025-03-01 ",
      description: "  Beratung  März ",
      counterparty: "\tKunde GmbH\n",
      reference: "   ",
      note: " Zeile 1\nZeile 2 ",
      externalId: "",
    });
    expect(booking).toMatchObject({
      date: "2025-03-01",
      description: "Beratung  März",
      counterparty: "Kunde GmbH",
      reference: null,
      note: "Zeile 1\nZeile 2",
      externalId: null,
    });
  });

  it("stores source and external ID as given (informational only)", async () => {
    const { create } = await setup();
    const booking = await create({ source: "stripe", externalId: " fee_123 ", reference: "R-1" });
    expect(booking).toMatchObject({ source: "stripe", externalId: "fee_123", reference: "R-1" });
  });

  it("accepts an expense with an expense category", async () => {
    const { create, expense } = await setup();
    const booking = await create({ type: "expense", categoryId: expense.id, vatRate: "19" });
    expect(booking.type).toBe("expense");
  });

  describe("validation", () => {
    it.each<[string, Partial<BookingFormInput>, BookingFieldError]>([
      ["empty date", { date: "  " }, { field: "date", code: "required" }],
      ["German date", { date: "01.03.2025" }, { field: "date", code: "invalidDate" }],
      ["non-existent day", { date: "2025-02-29" }, { field: "date", code: "invalidDate" }],
      ["year below 1000", { date: "0999-12-31" }, { field: "date", code: "invalidDate" }],
      ["date with time", { date: "2025-03-01T10:00" }, { field: "date", code: "invalidDate" }],
      ["unknown type", { type: "transfer" as BookingType }, { field: "type", code: "invalidType" }],
      ["zero amount", { grossCents: 0 }, { field: "grossCents", code: "amountNotPositive" }],
      ["negative amount", { grossCents: -100 }, { field: "grossCents", code: "amountNotPositive" }],
      [
        "fraction of a cent",
        { grossCents: 1.5 },
        { field: "grossCents", code: "amountNotInteger" },
      ],
      ["NaN", { grossCents: Number.NaN }, { field: "grossCents", code: "amountNotInteger" }],
      [
        "infinite amount",
        { grossCents: Number.POSITIVE_INFINITY },
        { field: "grossCents", code: "amountNotInteger" },
      ],
      [
        "unsafe integer",
        { grossCents: Number.MAX_SAFE_INTEGER + 1 },
        { field: "grossCents", code: "amountNotInteger" },
      ],
      [
        "unknown VAT rate",
        { vatRate: "16" as BookingFormInput["vatRate"] },
        { field: "vatRate", code: "vatRateInvalid" },
      ],
      ["unknown category", { categoryId: 999 }, { field: "categoryId", code: "categoryNotFound" }],
      ["blank description", { description: " \n " }, { field: "description", code: "required" }],
      ["blank counterparty", { counterparty: "" }, { field: "counterparty", code: "required" }],
      [
        "unknown source",
        { source: "paypal" as BookingFormInput["source"] },
        { field: "source", code: "invalidSource" },
      ],
    ])("rejects %s", async (_name, overrides, error) => {
      const { service, input } = await setup();
      expect(errorsOf(await service.create(input(overrides)))).toEqual([error]);
    });

    it("rejects a category of the other type", async () => {
      const { service, input, expense } = await setup();
      expect(errorsOf(await service.create(input({ categoryId: expense.id })))).toEqual([
        { field: "categoryId", code: "categoryTypeMismatch" },
      ]);
    });

    it("rejects an archived category for a new booking", async () => {
      const { service, input, archivedIncome } = await setup();
      expect(errorsOf(await service.create(input({ categoryId: archivedIncome.id })))).toEqual([
        { field: "categoryId", code: "categoryArchived" },
      ]);
    });

    it.each(Object.entries(BOOKING_TEXT_MAX_LENGTH))(
      "limits %s to %i characters (after trimming)",
      async (field, max) => {
        const { service, input } = await setup();
        const ok = await service.create(input({ [field]: ` ${"x".repeat(max)} ` }));
        expect(ok.ok).toBe(true);
        expect(errorsOf(await service.create(input({ [field]: "y".repeat(max + 1) })))).toEqual([
          { field, code: "tooLong" },
        ]);
      },
    );

    it("collects the errors of all fields in form order", async () => {
      const { service, input, expense } = await setup();
      const result = await service.create(
        input({
          date: "2025-02-30",
          grossCents: 0,
          vatRate: "16" as BookingFormInput["vatRate"],
          categoryId: expense.id,
          description: "",
          counterparty: " ",
          note: "n".repeat(BOOKING_TEXT_MAX_LENGTH.note + 1),
        }),
      );
      expect(errorsOf(result)).toEqual([
        { field: "date", code: "invalidDate" },
        { field: "grossCents", code: "amountNotPositive" },
        { field: "vatRate", code: "vatRateInvalid" },
        { field: "categoryId", code: "categoryTypeMismatch" },
        { field: "description", code: "required" },
        { field: "counterparty", code: "required" },
        { field: "note", code: "tooLong" },
      ]);
    });

    it("reports the VAT rule even when the amount is invalid", async () => {
      const { service, input } = await setup();
      expect(errorsOf(await service.create(input({ grossCents: -1, vatRate: null })))).toEqual([
        { field: "grossCents", code: "amountNotPositive" },
        { field: "vatRate", code: "vatRateRequired" },
      ]);
    });

    it("skips the VAT rule when the date (and so the tax year) is invalid", async () => {
      const { service, input } = await setup();
      expect(errorsOf(await service.create(input({ date: "x", vatRate: null })))).toEqual([
        { field: "date", code: "invalidDate" },
      ]);
    });

    it("skips the category type check when the type is invalid", async () => {
      const { service, input } = await setup();
      expect(errorsOf(await service.create(input({ type: "transfer" as BookingType })))).toEqual([
        { field: "type", code: "invalidType" },
      ]);
    });

    it("rejects a duplicate external ID of the same source", async () => {
      const { service, input, create } = await setup();
      await create({ source: "stripe", externalId: "fee_1" });
      expect(
        errorsOf(await service.create(input({ source: "stripe", externalId: "fee_1" }))),
      ).toEqual([{ field: "externalId", code: "externalIdDuplicate" }]);
      // Other source: no collision.
      expect((await service.create(input({ source: "manual", externalId: "fee_1" }))).ok).toBe(
        true,
      );
    });

    it("writes nothing when validation fails", async () => {
      const { service, input, repositories, income } = await setup();
      await service.create(input({ description: "" }));
      expect(await repositories.bookings.countByCategory(income.id)).toBe(0);
    });
  });
});

describe("BookingService.update", () => {
  it("replaces the fields and recomputes net and VAT", async () => {
    const { service, input, create, setNow } = await setup();
    const booking = await create();
    const later = new Date("2025-04-01T00:00:00.000Z");
    setNow(later);
    const result = await service.update(booking.id, input({ grossCents: 10700, vatRate: "7" }));
    expect(result).toEqual({
      ok: true,
      booking: {
        ...booking,
        grossCents: 10700,
        vatRate: "7",
        netCents: 10000,
        vatCents: 700,
        updatedAt: later.toISOString(),
      },
    });
  });

  it("applies the VAT rule of the new date's year", async () => {
    const { service, input, create } = await setup();
    const booking = await create({ date: "2025-03-01", vatRate: "19" });
    // Moving into the small business year 2024 with a rate fails …
    expect(errorsOf(await service.update(booking.id, input({ date: "2024-03-01" })))).toEqual([
      { field: "vatRate", code: "vatRateNotAllowed" },
    ]);
    // … without a rate it works: net = gross.
    const moved = await service.update(booking.id, input({ date: "2024-03-01", vatRate: null }));
    expect(moved).toMatchObject({ ok: true, booking: { vatRate: null, netCents: 11900 } });
    // And back into a regularly taxed year, a rate is required again.
    expect(
      errorsOf(await service.update(booking.id, input({ date: "2026-03-01", vatRate: null }))),
    ).toEqual([{ field: "vatRate", code: "vatRateRequired" }]);
  });

  it("keeps an already archived category, but does not switch to another archived one", async () => {
    const { service, input, create, repositories, income, archivedIncome, addCategory } =
      await setup();
    const booking = await create();
    await repositories.categories.setArchived(income.id, true);
    const kept = await service.update(booking.id, input({ description: "geändert" }));
    expect(kept).toMatchObject({ ok: true, booking: { categoryId: income.id } });

    expect(
      errorsOf(await service.update(booking.id, input({ categoryId: archivedIncome.id }))),
    ).toEqual([{ field: "categoryId", code: "categoryArchived" }]);
    const active = await addCategory("income", "Neu");
    expect((await service.update(booking.id, input({ categoryId: active.id }))).ok).toBe(true);
  });

  it("still checks the type of a kept archived category", async () => {
    const { service, input, create, repositories, income } = await setup();
    const booking = await create();
    await repositories.categories.setArchived(income.id, true);
    expect(errorsOf(await service.update(booking.id, input({ type: "expense" })))).toEqual([
      { field: "categoryId", code: "categoryTypeMismatch" },
    ]);
  });

  it("keeps omitted optional fields and clears them with null or blank strings", async () => {
    const { service, input, create } = await setup();
    const booking = await create({
      source: "stripe",
      externalId: "fee_1",
      reference: "R-1",
      note: "Notiz",
    });
    const kept = await service.update(booking.id, input({ description: "geändert" }));
    expect(kept).toMatchObject({
      ok: true,
      booking: { source: "stripe", externalId: "fee_1", reference: "R-1", note: "Notiz" },
    });
    const cleared = await service.update(
      booking.id,
      input({ externalId: null, reference: "", note: "  " }),
    );
    expect(cleared).toMatchObject({
      ok: true,
      booking: { source: "stripe", externalId: null, reference: null, note: null },
    });
  });

  it("allows keeping its own external ID but not taking another booking's", async () => {
    const { service, input, create } = await setup();
    await create({ source: "stripe", externalId: "fee_1" });
    const booking = await create({ source: "stripe", externalId: "fee_2" });
    expect(
      (await service.update(booking.id, input({ source: "stripe", externalId: "fee_2" }))).ok,
    ).toBe(true);
    expect(
      errorsOf(await service.update(booking.id, input({ source: "stripe", externalId: "fee_1" }))),
    ).toEqual([{ field: "externalId", code: "externalIdDuplicate" }]);
    // Changing the source makes the same ID collide with another booking's.
    const manual = await create({ externalId: "fee_1" });
    expect(errorsOf(await service.update(manual.id, input({ source: "stripe" })))).toEqual([
      { field: "externalId", code: "externalIdDuplicate" },
    ]);
  });

  it("changes nothing when validation fails", async () => {
    const { service, input, create, repositories } = await setup();
    const booking = await create();
    await service.update(booking.id, input({ description: "neu", grossCents: -1 }));
    expect(await repositories.bookings.findById(booking.id)).toEqual(booking);
  });

  it("returns notFound for an unknown booking (before validating)", async () => {
    const { service, input } = await setup();
    expect(await service.update(999, input({ description: "" }))).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("BookingService.get and delete", () => {
  it("loads a booking", async () => {
    const { service, create } = await setup();
    const booking = await create();
    expect(await service.get(booking.id)).toEqual({ ok: true, booking });
  });

  it("returns notFound for an unknown booking", async () => {
    const { service } = await setup();
    expect(await service.get(999)).toEqual({ ok: false, reason: "notFound" });
    expect(await service.delete(999)).toEqual({ ok: false, reason: "notFound" });
  });

  it("deletes a booking", async () => {
    const { service, create } = await setup();
    const booking = await create();
    expect(await service.delete(booking.id)).toEqual({ ok: true });
    expect(await service.get(booking.id)).toEqual({ ok: false, reason: "notFound" });
    expect(await service.delete(booking.id)).toEqual({ ok: false, reason: "notFound" });
  });

  it("allows re-creating a deleted booking's external ID", async () => {
    const { service, create } = await setup();
    const booking = await create({ source: "stripe", externalId: "fee_1" });
    await service.delete(booking.id);
    expect((await create({ source: "stripe", externalId: "fee_1" })).externalId).toBe("fee_1");
  });
});

/** Unit of work whose booking writes fail like a concurrent write would make them fail. */
function failingUnitOfWork(inner: UnitOfWork, error: Error): UnitOfWork {
  return {
    run: (fn) =>
      inner.run((repos: Repositories) =>
        fn({
          ...repos,
          bookings: {
            ...repos.bookings,
            insert: async () => Promise.reject(error),
            update: async () => Promise.reject(error),
          },
        }),
      ),
  };
}

describe("BookingService and constraint errors", () => {
  it.each([
    ["unique", { field: "externalId", code: "externalIdDuplicate" }],
    ["foreign_key", { field: "categoryId", code: "categoryNotFound" }],
  ] as const)("maps a %s violation to a field error", async (kind, fieldError) => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Umsatzerlöse",
      type: "income",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
    });
    const service = createBookingService({
      unitOfWork: failingUnitOfWork(unitOfWork, new ConstraintViolationError(kind, "boom")),
    });
    const result = await service.create({
      date: "2025-03-01",
      type: "income",
      grossCents: 100,
      vatRate: "19",
      categoryId: category.id,
      description: "x",
      counterparty: "y",
    });
    expect(result).toEqual({ ok: false, reason: "invalid", errors: [fieldError] });
  });

  it("rethrows other errors", async () => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Umsatzerlöse",
      type: "income",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
    });
    const service = createBookingService({
      unitOfWork: failingUnitOfWork(unitOfWork, new Error("disk I/O error")),
    });
    await expect(
      service.create({
        date: "2025-03-01",
        type: "income",
        grossCents: 100,
        vatRate: "19",
        categoryId: category.id,
        description: "x",
        counterparty: "y",
      }),
    ).rejects.toThrow("disk I/O error");
  });
});
