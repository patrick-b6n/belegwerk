import { describe, expect, it } from "vitest";

import { CSV_LINE_ENDING } from "@/business/csv";
import type { FileSaver, SaveTextFileRequest } from "@/business/files";
import { createTestDb } from "@/persistence/__tests__/test-db";

import { createAppServices } from "./services";

const NOW = new Date("2025-03-07T12:34:56.789Z");

async function setup(fileSaver?: FileSaver) {
  const { database, sqlite } = await createTestDb();
  const services = createAppServices(database, () => NOW, fileSaver);
  const categoryId = (type: string) =>
    (
      sqlite
        .prepare("SELECT id FROM categories WHERE type = ? AND archived = 0 ORDER BY id LIMIT 1")
        .get(type) as { id: number }
    ).id;
  return { services, sqlite, incomeId: categoryId("income"), expenseId: categoryId("expense") };
}

// The booking service through the composition root against the real
// persistence (better-sqlite3, migrations incl. default categories): its
// writes pass the database's CHECKs and the unit of work is a real
// transaction. Validation details are covered by the business unit tests.
describe("createAppServices – bookings on SQLite", () => {
  it("creates, loads, updates and deletes a booking", async () => {
    const { services, sqlite, incomeId } = await setup();
    const created = await services.bookings.create({
      date: "2025-03-01",
      type: "income",
      grossCents: 11900,
      vatRate: "19",
      categoryId: incomeId,
      description: " Beratung ",
      counterparty: "Kunde GmbH",
      reference: "RE-1",
      note: null,
      source: "stripe",
      externalId: "fee_1",
    });
    expect(created).toMatchObject({
      ok: true,
      booking: { netCents: 10000, vatCents: 1900, description: "Beratung" },
    });
    if (!created.ok) return;
    const { id } = created.booking;
    expect(await services.bookings.get(id)).toEqual(created);

    // Small business year: no rate, net = gross.
    sqlite.prepare("INSERT INTO tax_years (year, small_business) VALUES (2024, 1)").run();
    // Only the form's fields: source and external ID are omitted and kept.
    const updated = await services.bookings.update(id, {
      date: "2024-12-31",
      type: "income",
      grossCents: 11900,
      vatRate: null,
      categoryId: incomeId,
      description: "Beratung",
      counterparty: "Kunde GmbH",
      reference: "RE-1",
      note: "geändert",
    });
    expect(updated).toMatchObject({
      ok: true,
      booking: {
        vatRate: null,
        netCents: 11900,
        vatCents: 0,
        note: "geändert",
        source: "stripe",
        externalId: "fee_1",
      },
    });

    expect(await services.bookings.delete(id)).toEqual({ ok: true });
    expect(await services.bookings.get(id)).toEqual({ ok: false, reason: "notFound" });
  });

  it("returns field errors and writes nothing", async () => {
    const { services, sqlite, expenseId } = await setup();
    const result = await services.bookings.create({
      date: "2025-03-01",
      type: "income",
      grossCents: 100,
      vatRate: null,
      categoryId: expenseId,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "vatRate", code: "vatRateRequired" },
        { field: "categoryId", code: "categoryTypeMismatch" },
      ],
    });
    expect(sqlite.prepare("SELECT count(*) AS n FROM bookings").get()).toEqual({ n: 0 });
  });

  it("reports a duplicate external ID", async () => {
    const { services, incomeId } = await setup();
    const input = {
      date: "2025-03-01",
      type: "income",
      grossCents: 100,
      vatRate: "19",
      categoryId: incomeId,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "stripe",
      externalId: "fee_1",
    } as const;
    expect((await services.bookings.create(input)).ok).toBe(true);
    expect(await services.bookings.create(input)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "externalId", code: "externalIdDuplicate" }],
    });
  });
});

// The CSV export (#24) through the composition root: the bookings of the
// real search (SQLite), written by a fake save dialog.
describe("createAppServices – CSV export on SQLite", () => {
  it("exports every matching booking", async () => {
    const requests: SaveTextFileRequest[] = [];
    const { services, incomeId } = await setup({
      saveTextFile: async (request) => {
        requests.push(request);
        return { saved: true, path: "C:\\Export\\buchungen.csv" };
      },
    });
    for (const description of ["Müller", "Zeile;mit;Semikolon"]) {
      await services.bookings.create({
        date: "2025-03-01",
        type: "income",
        grossCents: 123456,
        vatRate: "19",
        categoryId: incomeId,
        description,
        counterparty: "Kunde",
        reference: null,
        note: null,
      });
    }
    const result = await services.bookingExport.exportCsv({
      query: { text: "e", sort: { field: "description", direction: "asc" }, pageSize: 1 },
      labels: {
        columns: {
          date: "Datum",
          type: "Art",
          description: "Beschreibung",
          counterparty: "Gegenpartei",
          category: "Kategorie",
          netCents: "Netto",
          vatRate: "USt-Satz",
          vatCents: "USt",
          grossCents: "Brutto",
          reference: "Referenz",
          note: "Notiz",
          source: "Quelle",
          externalId: "Externe ID",
        },
        types: { income: "Einnahme", expense: "Ausgabe" },
        vatRates: { "19": "19 %", "7": "7 %", "0": "0 %", reverse_charge: "Reverse Charge" },
        sources: { manual: "Manuell", stripe: "Stripe" },
      },
      fileName: { base: "buchungen", today: "2025-03-07", fromWord: "ab", toWord: "bis" },
      filterName: "CSV-Datei",
    });
    expect(result).toEqual({ ok: true, saved: true, fileName: "buchungen.csv", count: 2 });
    const rows = (requests[0]?.content ?? "").split(CRLF);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatch(
      /^01\.03\.2025;Einnahme;Müller;Kunde;[^;]+;1037,45;19 %;197,11;1234,56;;;Manuell;$/,
    );
    expect(rows[2]).toContain(';"Zeile;mit;Semikolon";');
    expect(rows[3]).toBe("");
  });
});

const CRLF = CSV_LINE_ENDING;

// The category service against SQLite with the seeded default categories.
describe("createAppServices – categories on SQLite", () => {
  it("lists the seeded categories with usage and protects the system categories", async () => {
    const { services, incomeId } = await setup();
    await services.bookings.create({
      date: "2025-03-01",
      type: "income",
      grossCents: 100,
      vatRate: "19",
      categoryId: incomeId,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
    });
    const list = await services.categories.list();
    expect(list.find((c) => c.id === incomeId)?.bookingCount).toBe(1);
    const system = list.filter((c) => c.isSystem);
    expect(system.map((c) => c.name).toSorted()).toEqual([
      "Erlösminderung / Rückerstattung",
      "USt-Erstattung",
      "USt-Vorauszahlung",
    ]);
    for (const { id } of system) {
      expect(await services.categories.delete(id)).toEqual({ ok: false, reason: "systemCategory" });
      expect(await services.categories.archive(id)).toEqual({
        ok: false,
        reason: "systemCategory",
      });
      expect(await services.categories.update(id, { euerPosition: "SONSTIGE_AUSGABEN" })).toEqual({
        ok: false,
        reason: "invalid",
        errors: [{ field: "euerPosition", code: "systemCategoryFixed" }],
      });
    }
    expect(await services.categories.delete(incomeId)).toEqual({
      ok: false,
      reason: "inUse",
      bookingCount: 1,
    });
  });

  it("creates, edits, archives, reactivates and deletes a category", async () => {
    const { services, sqlite } = await setup();
    expect(
      await services.categories.create({
        name: "TELEFON / INTERNET",
        type: "expense",
        euerPosition: "TELEKOMMUNIKATION",
        reducesIncome: false,
      }),
    ).toEqual({ ok: false, reason: "invalid", errors: [{ field: "name", code: "nameDuplicate" }] });

    const created = await services.categories.create({
      name: " Gutschriften ",
      type: "expense",
      euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
      reducesIncome: true,
    });
    expect(created).toMatchObject({
      ok: true,
      category: { name: "Gutschriften", isSystem: false },
    });
    if (!created.ok) return;
    const { id } = created.category;

    expect(
      await services.categories.update(id, {
        name: "Software-Abos",
        euerPosition: "EDV_KOSTEN",
        reducesIncome: false,
      }),
    ).toMatchObject({ ok: true, category: { name: "Software-Abos", reducesIncome: false } });
    expect(await services.categories.archive(id)).toMatchObject({
      ok: true,
      category: { archived: true },
    });
    expect(await services.categories.reactivate(id)).toMatchObject({
      ok: true,
      category: { archived: false },
    });
    expect(await services.categories.delete(id)).toEqual({ ok: true });
    expect(sqlite.prepare("SELECT count(*) AS n FROM categories WHERE id = ?").get(id)).toEqual({
      n: 0,
    });
  });
});

const booking = (incomeId: number, date: string, vatRate: "19" | null) =>
  ({
    date,
    type: "income",
    grossCents: 11900,
    vatRate,
    categoryId: incomeId,
    description: "x",
    counterparty: "y",
    reference: null,
    note: null,
  }) as const;

// The tax year service against SQLite, together with the booking service.
describe("createAppServices – tax years on SQLite", () => {
  it("adds years, lists years with bookings and switches the status", async () => {
    const { services, sqlite, incomeId } = await setup();
    expect(await services.taxYears.list()).toEqual([]);
    expect(await services.taxYears.addYear(2027)).toMatchObject({ ok: true });
    expect(await services.taxYears.addYear(2027)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "year", code: "yearExists" }],
    });
    expect((await services.bookings.create(booking(incomeId, "2025-03-01", "19"))).ok).toBe(true);
    expect(await services.taxYears.list()).toEqual([
      { year: 2025, smallBusiness: false, explicit: false, mismatchedBookings: 0 },
      { year: 2027, smallBusiness: false, explicit: true, mismatchedBookings: 0 },
    ]);

    // Switching 2025 conflicts with its booking until acknowledged.
    expect(await services.taxYears.setSmallBusiness(2025, true)).toEqual({
      ok: false,
      reason: "conflicts",
      mismatchedBookings: 1,
    });
    expect(sqlite.prepare("SELECT count(*) AS n FROM tax_years WHERE year = 2025").get()).toEqual({
      n: 0,
    });
    expect(
      await services.taxYears.setSmallBusiness(2025, true, { acknowledgeConflicts: true }),
    ).toEqual({
      ok: true,
      taxYear: { year: 2025, smallBusiness: true, explicit: true },
      mismatchedBookings: 1,
    });
    expect(await services.taxYears.get(2025)).toEqual({
      ok: true,
      taxYear: { year: 2025, smallBusiness: true, explicit: true },
    });
    expect(await services.taxYears.list()).toEqual([
      { year: 2025, smallBusiness: true, explicit: true, mismatchedBookings: 1 },
      { year: 2027, smallBusiness: false, explicit: true, mismatchedBookings: 0 },
    ]);

    // New bookings follow the new status.
    expect(await services.bookings.create(booking(incomeId, "2025-04-01", "19"))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "vatRate", code: "vatRateNotAllowed" }],
    });
    expect(await services.bookings.create(booking(incomeId, "2025-04-01", null))).toMatchObject({
      ok: true,
      booking: { vatRate: null, netCents: 11900, vatCents: 0 },
    });

    // Back to regular: the booking without a rate now conflicts.
    expect(await services.taxYears.setSmallBusiness(2025, false)).toEqual({
      ok: false,
      reason: "conflicts",
      mismatchedBookings: 1,
    });
  });
});
