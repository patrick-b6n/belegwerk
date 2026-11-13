import { describe, expect, it } from "vitest";

import { createTestDb } from "@/persistence/__tests__/test-db";

import { createAppServices } from "./services";

const NOW = new Date("2025-03-07T12:34:56.789Z");

async function setup() {
  const { database, sqlite } = await createTestDb();
  const services = createAppServices(database, () => NOW);
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
