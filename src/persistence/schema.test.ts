import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "./__tests__/test-db";
import { bookings, categories, settings, taxYears } from "./schema";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = "2025-03-07T12:34:56.789Z";

describe("schema migrations", () => {
  let db: TestDb["db"];
  let sqlite: TestDb["sqlite"];
  let incomeCategoryId: number;

  beforeEach(() => {
    ({ db, sqlite } = createTestDb());
    incomeCategoryId = db
      .insert(categories)
      .values({ name: "Umsatz", type: "income", euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG" })
      .returning({ id: categories.id })
      .get().id;
  });

  function insertBooking(overrides: Partial<typeof bookings.$inferInsert> = {}) {
    return db
      .insert(bookings)
      .values({
        date: "2025-03-07",
        type: "income",
        grossCents: 11900,
        vatRate: "19",
        netCents: 10000,
        vatCents: 1900,
        categoryId: incomeCategoryId,
        description: "Beratung",
        counterparty: "Kunde GmbH",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .returning()
      .get();
  }

  it("creates all tables with the expected indexes", () => {
    const names = sqlite
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    expect(names).toEqual(
      expect.arrayContaining([
        { type: "table", name: "bookings" },
        { type: "table", name: "categories" },
        { type: "table", name: "settings" },
        { type: "table", name: "tax_years" },
        { type: "index", name: "bookings_category_id_idx" },
        { type: "index", name: "bookings_date_idx" },
        { type: "index", name: "bookings_source_external_id_unique" },
        { type: "index", name: "categories_type_name_unique" },
      ]),
    );
  });

  it("round-trips a booking with defaults", () => {
    const booking = insertBooking({ reference: null, note: "Notiz" });
    expect(booking).toMatchObject({
      id: expect.any(Number),
      date: "2025-03-07",
      vatRate: "19",
      source: "manual",
      externalId: null,
      reference: null,
      note: "Notiz",
    });
  });

  it("maps boolean flags with defaults", () => {
    const category = db.select().from(categories).where(eq(categories.id, incomeCategoryId)).get();
    expect(category).toMatchObject({ reducesIncome: false, archived: false, isSystem: false });

    db.insert(taxYears).values({ year: 2025, smallBusiness: true }).run();
    expect(db.select().from(taxYears).get()).toEqual({ year: 2025, smallBusiness: true });
  });

  describe("unique (source, external_id) where external_id is not null", () => {
    it("rejects a duplicate external ID from the same source", () => {
      insertBooking({ source: "stripe", externalId: "ch_1" });
      expect(() => insertBooking({ source: "stripe", externalId: "ch_1" })).toThrow(/UNIQUE/);
    });

    it("allows the same external ID from another source", () => {
      insertBooking({ source: "stripe", externalId: "x_1" });
      expect(() => insertBooking({ source: "manual", externalId: "x_1" })).not.toThrow();
    });

    it("allows any number of bookings without external ID", () => {
      insertBooking({ source: "stripe" });
      insertBooking({ source: "stripe" });
      insertBooking();
      expect(() => insertBooking()).not.toThrow();
    });

    it("allows re-importing after the booking was deleted", () => {
      const booking = insertBooking({ source: "stripe", externalId: "ch_1" });
      db.delete(bookings).where(eq(bookings.id, booking.id)).run();
      expect(() => insertBooking({ source: "stripe", externalId: "ch_1" })).not.toThrow();
    });
  });

  describe("booking CHECK constraints", () => {
    it.each([
      ["no VAT rate (small business)", { vatRate: null, netCents: 11900, vatCents: 0 }],
      ["0 %", { vatRate: "0", netCents: 11900, vatCents: 0 }],
      ["7 %", { vatRate: "7", netCents: 11121, vatCents: 779 }],
      ["reverse charge", { vatRate: "reverse_charge", netCents: 11900, vatCents: 0 }],
      ["leap day", { date: "2024-02-29" }],
    ] as const)("accepts %s", (_, overrides) => {
      expect(() => insertBooking(overrides)).not.toThrow();
    });

    it.each([
      ["non-existent date", { date: "2025-02-30" }],
      ["date with time", { date: "2025-03-07T00:00" }],
      ["German date", { date: "07.03.2025" }],
      ["unknown type", { type: "transfer" }],
      ["unknown VAT rate", { vatRate: "16" }],
      ["unknown source", { source: "paypal" }],
      ["zero gross", { grossCents: 0, netCents: 0, vatCents: 0 }],
      ["negative gross", { grossCents: -100, netCents: -100, vatCents: 0 }],
      ["negative VAT", { grossCents: 100, netCents: 200, vatCents: -100 }],
      ["net + VAT != gross", { netCents: 10000, vatCents: 1000 }],
      ["VAT without VAT rate", { vatRate: null }],
    ])("rejects %s", (_, overrides) => {
      expect(() => insertBooking(overrides as Partial<typeof bookings.$inferInsert>)).toThrow(
        /CHECK constraint failed/,
      );
    });

    it("requires description and counterparty", () => {
      expect(() =>
        insertBooking({ description: null } as unknown as Partial<typeof bookings.$inferInsert>),
      ).toThrow(/NOT NULL/);
      expect(() =>
        insertBooking({ counterparty: null } as unknown as Partial<typeof bookings.$inferInsert>),
      ).toThrow(/NOT NULL/);
    });
  });

  describe("categories", () => {
    it("rejects a booking with an unknown category", () => {
      expect(() => insertBooking({ categoryId: 999 })).toThrow(/FOREIGN KEY/);
    });

    it("cannot be deleted while bookings reference them", () => {
      insertBooking();
      expect(() => db.delete(categories).where(eq(categories.id, incomeCategoryId)).run()).toThrow(
        /FOREIGN KEY/,
      );
    });

    it("have unique names per type", () => {
      const values = { name: "Umsatz", euerPosition: "SONSTIGE_AUSGABEN" };
      expect(() =>
        db
          .insert(categories)
          .values({ ...values, type: "income" })
          .run(),
      ).toThrow(/UNIQUE/);
      expect(() =>
        db
          .insert(categories)
          .values({ ...values, type: "expense" })
          .run(),
      ).not.toThrow();
    });

    it("only reduce income if they are expense categories", () => {
      const values = { name: "Rückerstattung", euerPosition: "X", reducesIncome: true };
      expect(() =>
        db
          .insert(categories)
          .values({ ...values, type: "income" })
          .run(),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        db
          .insert(categories)
          .values({ ...values, type: "expense" })
          .run(),
      ).not.toThrow();
    });
  });

  it("rejects implausible tax years", () => {
    expect(() => db.insert(taxYears).values({ year: 25 }).run()).toThrow(/CHECK constraint failed/);
  });

  it("stores settings as key/value pairs", () => {
    db.insert(settings).values({ key: "stripe.apiKey", value: "rk_test" }).run();
    expect(() => db.insert(settings).values({ key: "stripe.apiKey", value: "x" }).run()).toThrow(
      /UNIQUE/,
    );
  });
});
