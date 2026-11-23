import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { TEST_EUER_CSV_LABELS } from "@/business/__tests__/euer-csv-labels";
import { CSV_LINE_ENDING } from "@/business/csv";
import {
  createFakeStripeClient,
  stripeFee,
  stripeFeeRefund,
} from "@/business/__tests__/fake-stripe-client";
import { suggestStripeDefaults } from "@/business/stripe";
import type { FileSaver, PickSavePathRequest, SaveTextFileRequest } from "@/business/files";
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

const rows = (lines: readonly { line?: number; amountCents: number }[]) =>
  lines.map(({ line, amountCents }) => [line, amountCents]);

// The EÜR through the composition root on the seeded default categories:
// system categories are found by position and flag (never by name).
describe("createAppServices – EÜR on SQLite", () => {
  it("calculates a regularly taxed and a small-business year", async () => {
    const { services, sqlite } = await setup();
    const find = (type: string, position: string, reducesIncome = 0) =>
      (
        sqlite
          .prepare(
            "SELECT id FROM categories WHERE type = ? AND euer_position = ? AND reduces_income = ? ORDER BY id LIMIT 1",
          )
          .get(type, position, reducesIncome) as { id: number }
      ).id;
    const sales = find("income", "BETRIEBSEINNAHMEN_UST_PFLICHTIG");
    const refund = find("expense", "BETRIEBSEINNAHMEN_UST_PFLICHTIG", 1);
    const software = find("expense", "EDV_KOSTEN");
    const entertainment = find("expense", "BEWIRTUNG");
    const vatPayment = find("expense", "UST_AN_FA");
    const create = async (
      date: string,
      type: "income" | "expense",
      categoryId: number,
      grossCents: number,
      vatRate: "0" | "19" | null,
    ) => {
      const result = await services.bookings.create({
        date,
        type,
        grossCents,
        vatRate,
        categoryId,
        description: "x",
        counterparty: "y",
        reference: null,
        note: null,
      });
      expect(result.ok).toBe(true);
    };

    // 2026: regularly taxed (no record).
    await create("2026-01-15", "income", sales, 119000, "19");
    await create("2026-02-01", "income", sales, 50000, "0");
    await create("2026-02-15", "expense", refund, 11900, "19");
    await create("2026-03-01", "expense", software, 2380, "19");
    await create("2026-04-01", "expense", entertainment, 11900, "19");
    await create("2026-05-10", "expense", vatPayment, 10000, "0");
    // Another year: not counted.
    await create("2025-12-31", "income", sales, 999, "19");
    // Archived categories still count.
    expect((await services.categories.archive(software)).ok).toBe(true);

    const result = await services.euer.calculate(2026);
    if (!result.ok) throw new Error("expected ok");
    expect(rows(result.euer.income)).toEqual([
      [15, 90000], // 100000 − 10000 refund
      [16, 50000],
      [17, 17100], // 19000 − 1900
    ]);
    expect(rows(result.euer.expenses)).toEqual([
      [51, 2000],
      [58, 380 + 1900], // input VAT of software and entertainment (in full)
      [59, 10000],
      [64, 7000], // 70 % of 10000
    ]);
    expect(result.euer.expenses.at(-1)?.entertainment).toEqual({
      totalCents: 10000,
      deductibleCents: 7000,
      nonDeductibleCents: 3000,
    });
    expect(result.euer.totals).toEqual({
      incomeCents: 157100,
      expenseCents: 21280,
      profitCents: 135820,
    });
    expect(result.euer.warnings).toEqual([{ code: "entertainmentSplit" }]);

    // 2025 as small business: gross into line 12, no VAT lines.
    expect(
      (await services.taxYears.setSmallBusiness(2025, true, { acknowledgeConflicts: true })).ok,
    ).toBe(true);
    await create("2025-06-01", "income", sales, 5000, null);
    const small = await services.euer.calculate(2025);
    if (!small.ok) throw new Error("expected ok");
    expect(small.euer).toMatchObject({
      smallBusiness: true,
      income: [{ position: "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER", line: 12, amountCents: 5999 }],
      expenses: [],
      totals: { incomeCents: 5999, expenseCents: 0, profitCents: 5999 },
      warnings: [{ code: "vatRateInSmallBusinessYear", bookingCount: 1 }],
    });
  });
});

describe("createAppServices – EÜR CSV export on SQLite", () => {
  it("exports a regular and a small-business year", async () => {
    const requests: SaveTextFileRequest[] = [];
    const { services, sqlite } = await setup({
      saveTextFile: async (request) => {
        requests.push(request);
        return { saved: true, path: `C:\\Export\\${request.defaultFileName}` };
      },
    });
    const find = (type: string, position: string) =>
      (
        sqlite
          .prepare(
            "SELECT id FROM categories WHERE type = ? AND euer_position = ? AND reduces_income = 0 ORDER BY id LIMIT 1",
          )
          .get(type, position) as { id: number }
      ).id;
    const create = async (
      date: string,
      type: "income" | "expense",
      categoryId: number,
      grossCents: number,
      vatRate: "19" | null,
    ) => {
      const created = await services.bookings.create({
        date,
        type,
        grossCents,
        vatRate,
        categoryId,
        description: "x",
        counterparty: "y",
        reference: null,
        note: null,
      });
      expect(created.ok).toBe(true);
    };
    const sales = find("income", "BETRIEBSEINNAHMEN_UST_PFLICHTIG");
    const entertainment = find("expense", "BEWIRTUNG");
    await create("2026-01-15", "income", sales, 119000, "19");
    await create("2026-04-01", "expense", entertainment, 11900, "19");
    expect(
      (await services.taxYears.setSmallBusiness(2025, true, { acknowledgeConflicts: true })).ok,
    ).toBe(true);
    await create("2025-06-01", "income", sales, 5000, null);

    const exportYear = (year: number) =>
      services.euerExport.exportCsv({
        year,
        labels: TEST_EUER_CSV_LABELS,
        fileNameBase: "euer",
        filterName: "CSV",
      });

    expect(await exportYear(2026)).toEqual({
      ok: true,
      saved: true,
      fileName: "euer-2026.csv",
      year: 2026,
    });
    expect(await exportYear(2025)).toEqual({
      ok: true,
      saved: true,
      fileName: "euer-2025.csv",
      year: 2025,
    });
    const [regular, small] = requests.map((request) =>
      request.content.slice(1).split(CRLF).slice(0, -1),
    );
    expect(regular).toEqual([
      "Bereich;Zeile;Bezeichnung;Betrag;Nicht abziehbar",
      expect.stringMatching(/^Betriebseinnahmen;15;[^;]+;1000,00;$/),
      expect.stringMatching(/^Betriebseinnahmen;17;[^;]+;190,00;$/),
      expect.stringMatching(/^Betriebsausgaben;58;[^;]+;19,00;$/),
      "Betriebsausgaben;64;Bewirtungsaufwendungen;70,00;30,00",
      "Ergebnis;;Summe Betriebseinnahmen;1190,00;",
      "Ergebnis;;Summe Betriebsausgaben;89,00;",
      "Ergebnis;;Gewinn;1101,00;",
    ]);
    expect(small).toEqual([
      "Bereich;Zeile;Bezeichnung;Betrag;Nicht abziehbar",
      expect.stringMatching(/^Betriebseinnahmen;12;[^;]+;50,00;$/),
      "Ergebnis;;Summe Betriebseinnahmen;50,00;",
      "Ergebnis;;Summe Betriebsausgaben;0,00;",
      "Ergebnis;;Gewinn;50,00;",
    ]);
  });
});

// The Stripe settings (#28) against SQLite: the seeded categories give the
// suggested defaults, which pass the service's validation; the key is
// stored in the settings table and returned masked only.
describe("createAppServices – Stripe settings on SQLite", () => {
  it("stores key and defaults", async () => {
    const { services, sqlite } = await setup();
    const key = "rk_test_FAKE0123456789abcdefghijKLMNOP";
    expect(await services.stripeSettings.get()).toEqual({
      apiKey: null,
      defaults: { defaultVatRate: null, feeCategoryId: null, refundCategoryId: null },
    });
    expect(await services.stripeSettings.setApiKey(key)).toEqual({
      ok: true,
      apiKey: { masked: "rk_test_…MNOP", mode: "test" },
    });
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'stripe.apiKey'").get()).toEqual({
      value: key,
    });
    expect(JSON.stringify(await services.stripeSettings.get())).not.toContain(key);

    const suggested = suggestStripeDefaults(await services.categories.list());
    const name = (id: number | null) =>
      (sqlite.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string }).name;
    expect(name(suggested.feeCategoryId)).toBe("Umsatzerlöse");
    expect(name(suggested.refundCategoryId)).toBe("Erlösminderung / Rückerstattung");
    const defaults = {
      defaultVatRate: suggested.defaultVatRate,
      feeCategoryId: suggested.feeCategoryId ?? 0,
      refundCategoryId: suggested.refundCategoryId ?? 0,
    };
    expect(await services.stripeSettings.setDefaults(defaults)).toEqual({ ok: true, defaults });
    expect(await services.stripeSettings.get()).toEqual({
      apiKey: { masked: "rk_test_…MNOP", mode: "test" },
      defaults,
    });

    expect(await services.stripeSettings.deleteApiKey()).toEqual({ ok: true, deleted: true });
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key = 'stripe.apiKey'").get(),
    ).toEqual({
      n: 0,
    });
  });
});

const at = (iso: string) => Date.parse(iso) / 1000;

describe("createAppServices – Stripe import on SQLite", () => {
  it("imports fees and refunds in one transaction and skips them the next time", async () => {
    const { database, sqlite } = await createTestDb();
    const stripeClient = createFakeStripeClient();
    const services = createAppServices(database, () => NOW, undefined, stripeClient);
    stripeClient.fees.push(
      stripeFee({
        id: "fee_int1",
        amount: 1190,
        account: "acct_int",
        created: at("2025-02-01T12:00:00Z"),
        refunds: [
          stripeFeeRefund({ id: "fr_int1", amount: 119, created: at("2025-02-10T12:00:00Z") }),
        ],
      }),
      stripeFee({ id: "fee_usd", currency: "usd", created: at("2025-02-02T12:00:00Z") }),
    );
    const range = { from: "2025-01-01", to: "2025-03-07" };
    expect(await services.stripeImport.import(range)).toEqual({ ok: false, reason: "noApiKey" });

    await services.stripeSettings.setApiKey("rk_test_FAKEFAKEFAKEFAKE0123456789");
    const suggested = suggestStripeDefaults(await services.categories.list());
    await services.stripeSettings.setDefaults({
      defaultVatRate: suggested.defaultVatRate,
      feeCategoryId: suggested.feeCategoryId ?? 0,
      refundCategoryId: suggested.refundCategoryId ?? 0,
    });

    expect(await services.stripeImport.import(range)).toMatchObject({
      ok: true,
      created: 2,
      skipped: 0,
      failed: [{ externalId: "fee_usd", code: "unsupportedCurrency" }],
    });
    expect(
      sqlite
        .prepare(
          "SELECT external_id, type, gross_cents, net_cents, vat_cents, vat_rate, source, reference FROM bookings ORDER BY date",
        )
        .all(),
    ).toEqual([
      {
        external_id: "fee_int1",
        type: "income",
        gross_cents: 1190,
        net_cents: 1000,
        vat_cents: 190,
        vat_rate: "19",
        source: "stripe",
        reference: null,
      },
      {
        external_id: "fr_int1",
        type: "expense",
        gross_cents: 119,
        net_cents: 100,
        vat_cents: 19,
        vat_rate: "19",
        source: "stripe",
        reference: "fee_int1",
      },
    ]);
    expect(await services.stripeImport.getStatus()).toEqual({
      lastImportAt: NOW.toISOString(),
      lastImportTo: "2025-03-07",
    });
    expect(await services.stripeImport.import(range)).toMatchObject({
      ok: true,
      created: 0,
      skipped: 2,
    });
  });
});

describe("createAppServices – backup on SQLite", () => {
  it("suggests a dated name and writes a copy of the database to the picked path", async () => {
    const { database, sqlite } = await createTestDb();
    const dir = mkdtempSync(join(tmpdir(), "belegwerk-backup-"));
    try {
      const path = join(dir, "Meine Sicherung.db");
      const requests: PickSavePathRequest[] = [];
      const services = createAppServices(
        database,
        () => NOW,
        undefined,
        undefined,
        {
          pickSavePath: async (request) => {
            requests.push(request);
            return path;
          },
        },
        // The app's DatabaseBackup empties the file via tauri-plugin-fs first;
        // the target does not exist here.
        { writeTo: (target) => database.backupTo(target) },
      );

      expect(
        await services.backup.createBackup({
          fileNameBase: "belegwerk-backup",
          filterName: "SQLite-Datenbank",
        }),
      ).toEqual({ saved: true, fileName: "Meine Sicherung.db", path });
      // NOW = 12:34 UTC = 13:34 in Berlin (CET).
      expect(requests[0]?.defaultFileName).toBe("belegwerk-backup-2025-03-07_1334.db");

      const backup = new Database(path, { readonly: true });
      try {
        const count = "SELECT count(*) AS n FROM categories";
        expect(backup.prepare(count).get()).toEqual(sqlite.prepare(count).get());
      } finally {
        backup.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
