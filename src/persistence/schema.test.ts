import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestDb, dbError } from "./__tests__/test-db";
import { bookings, categories, settings, taxYears } from "./schema";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const NOW = "2025-03-07T12:34:56.789Z";

/** Booking overrides setting a NOT NULL column to null (bypassing the types). */
function nulls(column: string) {
  return { [column]: null } as Partial<typeof bookings.$inferInsert>;
}

describe("schema migrations", () => {
  let db: TestDb["db"];
  let sqlite: TestDb["sqlite"];
  let incomeCategoryId: number;

  beforeEach(async () => {
    ({ db, sqlite } = await createTestDb());
    const category = await db
      .insert(categories)
      .values({ name: "Umsatz", type: "income", euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG" })
      .returning({ id: categories.id })
      .get();
    incomeCategoryId = category.id;
  });

  async function insertBooking(overrides: Partial<typeof bookings.$inferInsert> = {}) {
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

  it("round-trips a booking with defaults", async () => {
    const booking = await insertBooking({ reference: null, note: "Notiz" });
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

  it("maps boolean flags with defaults", async () => {
    const category = await db
      .select()
      .from(categories)
      .where(eq(categories.id, incomeCategoryId))
      .get();
    expect(category).toMatchObject({ reducesIncome: false, archived: false, isSystem: false });

    await db.insert(taxYears).values({ year: 2025, smallBusiness: true }).run();
    expect(await db.select().from(taxYears).get()).toEqual({ year: 2025, smallBusiness: true });
  });

  describe("unique (source, external_id) where external_id is not null", () => {
    it("rejects a duplicate external ID from the same source", async () => {
      await insertBooking({ source: "stripe", externalId: "ch_1" });
      expect(await dbError(insertBooking({ source: "stripe", externalId: "ch_1" }))).toMatch(
        /UNIQUE/,
      );
    });

    it("allows the same external ID from another source", async () => {
      await insertBooking({ source: "stripe", externalId: "x_1" });
      await expect(insertBooking({ source: "manual", externalId: "x_1" })).resolves.toBeDefined();
    });

    it("allows any number of bookings without external ID", async () => {
      await insertBooking({ source: "stripe" });
      await insertBooking({ source: "stripe" });
      await insertBooking();
      await expect(insertBooking()).resolves.toBeDefined();
    });

    it("allows re-importing after the booking was deleted", async () => {
      const booking = await insertBooking({ source: "stripe", externalId: "ch_1" });
      await db.delete(bookings).where(eq(bookings.id, booking.id)).run();
      await expect(insertBooking({ source: "stripe", externalId: "ch_1" })).resolves.toBeDefined();
    });
  });

  describe("booking CHECK constraints", () => {
    it.each([
      ["no VAT rate (small business)", { vatRate: null, netCents: 11900, vatCents: 0 }],
      ["0 %", { vatRate: "0", netCents: 11900, vatCents: 0 }],
      ["7 %", { vatRate: "7", netCents: 11121, vatCents: 779 }],
      ["reverse charge", { vatRate: "reverse_charge", netCents: 11900, vatCents: 0 }],
      ["leap day", { date: "2024-02-29" }],
    ] as const)("accepts %s", async (_, overrides) => {
      await expect(insertBooking(overrides)).resolves.toBeDefined();
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
      ["VAT at 0 %", { vatRate: "0" }],
      ["VAT with reverse charge", { vatRate: "reverse_charge" }],
      ["fractional gross cents", { grossCents: 11900.5, netCents: 10000.5 }],
      ["fractional net/VAT cents", { netCents: 9999.5, vatCents: 1900.5 }],
      ["non-numeric cents", { grossCents: "viel", netCents: "viel", vatCents: 0 }],
      ["empty external ID", { source: "stripe", externalId: "" }],
    ])("rejects %s", async (_, overrides) => {
      expect(
        await dbError(insertBooking(overrides as Partial<typeof bookings.$inferInsert>)),
      ).toMatch(/CHECK constraint failed/);
    });

    it("stores numeric text as integer cents (SQLite type affinity)", async () => {
      // INTEGER affinity converts '11900' to 11900 before the CHECKs run.
      const booking = await insertBooking({ grossCents: "11900" } as unknown as Partial<
        typeof bookings.$inferInsert
      >);
      const row = sqlite
        .prepare("SELECT typeof(gross_cents) AS type, gross_cents FROM bookings WHERE id = ?")
        .get(booking.id);
      expect(row).toEqual({ type: "integer", gross_cents: 11900 });
    });

    it("requires description and counterparty", async () => {
      expect(await dbError(insertBooking(nulls("description")))).toMatch(/NOT NULL/);
      expect(await dbError(insertBooking(nulls("counterparty")))).toMatch(/NOT NULL/);
    });
  });

  describe("categories", () => {
    it("rejects a booking with an unknown category", async () => {
      expect(await dbError(insertBooking({ categoryId: 999 }))).toMatch(/FOREIGN KEY/);
    });

    it("cannot be deleted while bookings reference them", async () => {
      await insertBooking();
      const deletion = db.delete(categories).where(eq(categories.id, incomeCategoryId)).run();
      expect(await dbError(deletion)).toMatch(/FOREIGN KEY/);
    });

    it("have unique names per type", async () => {
      const values = { name: "Umsatz", euerPosition: "SONSTIGE_AUSGABEN" };
      const insert = (type: "income" | "expense") =>
        db
          .insert(categories)
          .values({ ...values, type })
          .run();
      expect(await dbError(insert("income"))).toMatch(/UNIQUE/);
      await insert("expense");
    });

    it("only reduce income if they are expense categories", async () => {
      const values = { name: "Rückerstattung", euerPosition: "X", reducesIncome: true };
      const insert = (type: "income" | "expense") =>
        db
          .insert(categories)
          .values({ ...values, type })
          .run();
      expect(await dbError(insert("income"))).toMatch(/CHECK constraint failed/);
      await insert("expense");
    });
  });

  it("rejects implausible tax years", async () => {
    expect(await dbError(db.insert(taxYears).values({ year: 25 }).run())).toMatch(
      /CHECK constraint failed/,
    );
  });

  it("stores settings as key/value pairs", async () => {
    await db.insert(settings).values({ key: "stripe.apiKey", value: "rk_test" }).run();
    expect(
      await dbError(db.insert(settings).values({ key: "stripe.apiKey", value: "x" }).run()),
    ).toMatch(/UNIQUE/);
  });
});
