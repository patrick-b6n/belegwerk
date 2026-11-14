import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import { MAX_AMOUNT_CENTS } from "../money";
import type { Booking, BookingType } from "../model";
import type { ConstraintKind, Repositories, UnitOfWork } from "../repositories";
import { ConstraintViolationError } from "../repositories";
import {
  BOOKING_TEXT_MAX_LENGTH,
  type BookingFieldError,
  type BookingFormInput,
  type BookingService,
  createBookingService,
} from "./booking-service";
import { type BookingQuery, DEFAULT_BOOKING_PAGE_SIZE } from "./booking-query";

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
    reference: null,
    note: null,
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
        "amount above the maximum",
        { grossCents: MAX_AMOUNT_CENTS + 1 },
        { field: "grossCents", code: "amountTooLarge" },
      ],
      [
        "infinite amount",
        { grossCents: Number.POSITIVE_INFINITY },
        { field: "grossCents", code: "amountTooLarge" },
      ],
      [
        "unsafe integer",
        { grossCents: Number.MAX_SAFE_INTEGER + 1 },
        { field: "grossCents", code: "amountTooLarge" },
      ],
      [
        "unknown VAT rate",
        { vatRate: "16" as BookingFormInput["vatRate"] },
        { field: "vatRate", code: "vatRateInvalid" },
      ],
      ["unknown category", { categoryId: 999 }, { field: "categoryId", code: "categoryNotFound" }],
      ["no category (NaN)", { categoryId: Number.NaN }, { field: "categoryId", code: "required" }],
      ["category id 0", { categoryId: 0 }, { field: "categoryId", code: "required" }],
      ["fractional category id", { categoryId: 1.5 }, { field: "categoryId", code: "required" }],
      [
        "zero-width-only description",
        { description: "\u200B\u200C\u200D\uFEFF " },
        { field: "description", code: "required" },
      ],
      [
        "zero-width-only counterparty",
        { counterparty: " \u200B" },
        { field: "counterparty", code: "required" },
      ],
      [
        "invisible-only description (word joiner, soft hyphen, Mongolian vowel separator)",
        { description: "\u2060\u00AD\u180E\u00A0" },
        { field: "description", code: "required" },
      ],
      [
        "invisible-only counterparty (directional marks)",
        { counterparty: "\u200E\u200F\u2061" },
        { field: "counterparty", code: "required" },
      ],
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

    it("accepts the maximum amount", async () => {
      const { create } = await setup();
      const booking = await create({ grossCents: MAX_AMOUNT_CENTS });
      expect(booking.netCents + booking.vatCents).toBe(MAX_AMOUNT_CENTS);
    });

    it("strips zero-width characters at the ends, keeps inner ones and blanks optional texts", async () => {
      const { create } = await setup();
      const booking = await create({
        description: "\u200BBeratung\uFEFF",
        counterparty: "Team \u{1F468}\u200D\u{1F4BB}",
        reference: "\u200B",
        note: "\u00AD\u2060",
        externalId: "\uFEFF\u200B",
      });
      expect(booking).toMatchObject({
        description: "Beratung",
        counterparty: "Team \u{1F468}\u200D\u{1F4BB}",
        reference: null,
        note: null,
        externalId: null,
      });
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

  it("keeps omitted source and external ID; clears texts with null or blank strings", async () => {
    const { service, input, create } = await setup();
    const booking = await create({
      source: "stripe",
      externalId: "fee_1",
      reference: "R-1",
      note: "Notiz",
    });
    const kept = await service.update(
      booking.id,
      input({ description: "geändert", reference: "R-1", note: "Notiz" }),
    );
    expect(kept).toMatchObject({
      ok: true,
      booking: { source: "stripe", externalId: "fee_1", reference: "R-1", note: "Notiz" },
    });
    // reference and note are always stated: null clears them.
    const nulls = await service.update(booking.id, input());
    expect(nulls).toMatchObject({
      ok: true,
      booking: { source: "stripe", externalId: "fee_1", reference: null, note: null },
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

  it.each([Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "returns notFound for the invalid id %s without querying",
    async (id) => {
      const { service, input } = await setup();
      expect(await service.get(id)).toEqual({ ok: false, reason: "notFound" });
      expect(await service.update(id, input())).toEqual({ ok: false, reason: "notFound" });
      expect(await service.delete(id)).toEqual({ ok: false, reason: "notFound" });
    },
  );

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

/** The ok result of `list`, or a failing test. */
async function listed(service: BookingService, query?: BookingQuery) {
  const result = await service.list(query);
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result)}`);
  return result;
}

describe("BookingService.list", () => {
  const EMPTY_SUMS = { incomeCents: 0, expenseCents: 0, balanceCents: 0 };

  it("returns an empty first page without bookings", async () => {
    const { service } = await setup();
    expect(await service.list()).toEqual({
      ok: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: DEFAULT_BOOKING_PAGE_SIZE,
      pageCount: 1,
      sums: EMPTY_SUMS,
    });
  });

  it("lists bookings newest first with their category", async () => {
    const { service, create, income, expense } = await setup();
    const older = await create({ date: "2025-01-15" });
    const firstOfDay = await create({
      date: "2025-03-01",
      type: "expense",
      categoryId: expense.id,
      grossCents: 1070,
      vatRate: "7",
    });
    const secondOfDay = await create({ date: "2025-03-01" });
    const smallBusiness = await create({ date: "2024-12-31", vatRate: null });

    const { items } = await listed(service);
    expect(items).toEqual([
      { ...secondOfDay, category: { id: income.id, name: income.name, archived: false } },
      { ...firstOfDay, category: { id: expense.id, name: expense.name, archived: false } },
      { ...older, category: { id: income.id, name: income.name, archived: false } },
      { ...smallBusiness, category: { id: income.id, name: income.name, archived: false } },
    ]);
    expect(items[1]).toMatchObject({ netCents: 1000, vatCents: 70, grossCents: 1070 });
  });

  it("marks archived categories and shows current category names", async () => {
    const { service, create, income, repositories } = await setup();
    const booking = await create();
    await repositories.categories.update(income.id, { name: "Erlöse" });
    await repositories.categories.setArchived(income.id, true);

    expect((await listed(service)).items).toEqual([
      { ...booking, category: { id: income.id, name: "Erlöse", archived: true } },
    ]);
  });

  it("filters, sorts and sums gross amounts over all matching bookings", async () => {
    const { service, create, expense } = await setup();
    const consulting = await create({ grossCents: 11900, counterparty: "Müller GmbH" });
    await create({ grossCents: 5000, counterparty: "Schmidt AG" });
    const phone = await create({
      type: "expense",
      categoryId: expense.id,
      grossCents: 2380,
      counterparty: "MÜLLER Telefon",
      date: "2025-03-02",
    });

    const result = await listed(service, {
      text: "  müller ",
      sort: { field: "grossCents", direction: "asc" },
    });
    expect(result.items.map((item) => item.id)).toEqual([phone.id, consulting.id]);
    expect(result.total).toBe(2);
    expect(result.sums).toEqual({ incomeCents: 11900, expenseCents: 2380, balanceCents: 9520 });

    // A negative balance for a loss.
    expect((await listed(service, { type: "expense" })).sums).toEqual({
      incomeCents: 0,
      expenseCents: 2380,
      balanceCents: -2380,
    });
  });

  it("pages through the result; total and sums cover all pages", async () => {
    const { service, create } = await setup();
    const ids: number[] = [];
    for (let day = 1; day <= 5; day += 1) {
      ids.unshift((await create({ date: `2025-03-0${day}`, grossCents: day * 100 })).id);
    }
    const page = async (number: number) => {
      const result = await listed(service, { page: number, pageSize: 2 });
      return {
        ids: result.items.map((item) => item.id),
        page: result.page,
        pageCount: result.pageCount,
        total: result.total,
        income: result.sums.incomeCents,
      };
    };

    expect(await page(1)).toEqual({
      ids: ids.slice(0, 2),
      page: 1,
      pageCount: 3,
      total: 5,
      income: 1500,
    });
    expect(await page(2)).toEqual({
      ids: ids.slice(2, 4),
      page: 2,
      pageCount: 3,
      total: 5,
      income: 1500,
    });
    expect(await page(3)).toEqual({
      ids: ids.slice(4),
      page: 3,
      pageCount: 3,
      total: 5,
      income: 1500,
    });
    // A page after the last gives the last page.
    expect(await page(4)).toEqual(await page(3));
    expect(await page(1000)).toEqual(await page(3));
  });

  it("stores texts NFC-normalized so composed and decomposed searches find them", async () => {
    const { service, create } = await setup();
    const decomposed = "Mu\u0308ller";
    const booking = await create({
      description: decomposed,
      counterparty: decomposed,
      reference: decomposed,
      note: decomposed,
      externalId: decomposed,
    });
    expect(booking).toMatchObject({
      description: "Müller",
      counterparty: "Müller",
      reference: "Müller",
      note: "Müller",
      // External IDs stay exactly as given.
      externalId: decomposed,
    });
    for (const text of ["müller", "MU\u0308LLER"]) {
      expect((await listed(service, { text })).items.map((item) => item.id)).toEqual([booking.id]);
    }
  });

  it("rejects a search text with NUL or a lone surrogate without querying", async () => {
    const { service, create } = await setup();
    await create();
    for (const text of ["\u0000", "a\u0000b", "\ud800"]) {
      expect(await service.list({ text })).toEqual({
        ok: false,
        reason: "invalid",
        errors: [{ field: "text", code: "invalidText" }],
      });
    }
  });

  it("returns every matching booking with pageSize 'all'", async () => {
    const { service, create } = await setup();
    for (let index = 0; index < DEFAULT_BOOKING_PAGE_SIZE + 5; index += 1) await create();

    const page = await listed(service);
    expect(page.items).toHaveLength(DEFAULT_BOOKING_PAGE_SIZE);
    expect(page.pageCount).toBe(2);

    const all = await listed(service, { pageSize: "all", page: 3 });
    expect(all.items).toHaveLength(DEFAULT_BOOKING_PAGE_SIZE + 5);
    expect(all).toMatchObject({ page: 1, pageCount: 1, pageSize: "all", total: 55 });
  });

  it("rejects an invalid query without touching the database", async () => {
    const { unitOfWork } = createInMemoryDatabase();
    let runs = 0;
    const counting: UnitOfWork = {
      run: (fn) => {
        runs += 1;
        return unitOfWork.run(fn);
      },
    };
    const result = await createBookingService({ unitOfWork: counting }).list({
      dateFrom: "2025-02-30",
      page: 0,
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "dateFrom", code: "invalidDate" },
        { field: "page", code: "invalidPage" },
      ],
    });
    expect(runs).toBe(0);
  });

  it("reads totals, bookings and categories in one unit of work", async () => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Umsatzerlöse",
      type: "income",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
    });
    await repositories.bookings.insert({
      date: "2025-03-01",
      type: "income",
      grossCents: 100,
      vatRate: null,
      netCents: 100,
      vatCents: 0,
      categoryId: category.id,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "manual",
      externalId: null,
    });
    let runs = 0;
    const counting: UnitOfWork = {
      run: (fn) => {
        runs += 1;
        return unitOfWork.run(fn);
      },
    };
    const result = await createBookingService({ unitOfWork: counting }).list();
    expect(result).toMatchObject({ ok: true, total: 1 });
    expect(runs).toBe(1);
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
      reference: null,
      note: null,
    });
    expect(result).toEqual({ ok: false, reason: "invalid", errors: [fieldError] });
  });

  it.each([
    ["a plain error", new Error("disk I/O error")],
    [
      "a constraint error of another kind",
      new ConstraintViolationError("check" as ConstraintKind, "disk I/O error"),
    ],
  ])("rethrows %s", async (_name, error) => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Umsatzerlöse",
      type: "income",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
    });
    const service = createBookingService({
      unitOfWork: failingUnitOfWork(unitOfWork, error),
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
        reference: null,
        note: null,
      }),
    ).rejects.toThrow("disk I/O error");
  });
});

describe("BookingService.suggestTexts", () => {
  it("returns nothing without bookings", async () => {
    const { service } = await setup();
    expect(await service.suggestTexts({ field: "description" })).toEqual([]);
  });

  it("suggests earlier texts, frequent and recent first, one per text ignoring case", async () => {
    const { service, create } = await setup();
    await create({ date: "2025-01-10", description: "Beratung", counterparty: "Müller GmbH" });
    await create({ date: "2025-02-10", description: "beratung", counterparty: "MÜLLER GmbH" });
    await create({ date: "2025-03-01", description: "Workshop", counterparty: "Schmidt AG" });
    await create({ date: "2025-01-05", description: "  Beratung  ", counterparty: "Müller GmbH" });

    expect(await service.suggestTexts({ field: "description" })).toEqual(["Beratung", "Workshop"]);
    expect(await service.suggestTexts({ field: "counterparty" })).toEqual([
      "Müller GmbH",
      "Schmidt AG",
    ]);
  });

  it("puts texts of the given type first, then the other type's", async () => {
    const { service, create, expense } = await setup();
    await create({ counterparty: "Kunde GmbH" });
    await create({ counterparty: "Kunde GmbH" });
    await create({
      type: "expense",
      categoryId: expense.id,
      counterparty: "Telekom",
    });

    expect(await service.suggestTexts({ field: "counterparty", type: "expense" })).toEqual([
      "Telekom",
      "Kunde GmbH",
    ]);
    expect(await service.suggestTexts({ field: "counterparty", type: "income" })).toEqual([
      "Kunde GmbH",
      "Telekom",
    ]);
  });

  it("limits the number of suggestions", async () => {
    const { service, create } = await setup();
    for (const description of ["A", "B", "C"]) await create({ description });
    expect(await service.suggestTexts({ field: "description", limit: 2 })).toHaveLength(2);
  });

  it("rejects an unknown field, type or limit as a programmer error", async () => {
    const { service } = await setup();
    await expect(
      service.suggestTexts({ field: "note" as unknown as "description" }),
    ).rejects.toThrow(RangeError);
    await expect(
      service.suggestTexts({ field: "description", type: "other" as unknown as BookingType }),
    ).rejects.toThrow(RangeError);
    for (const limit of [0, 1.5, 1001, Number.NaN]) {
      await expect(service.suggestTexts({ field: "description", limit })).rejects.toThrow(
        RangeError,
      );
    }
  });
});
