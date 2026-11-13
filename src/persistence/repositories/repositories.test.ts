import { describe, expect, it } from "vitest";

import { describeRepositoryContract } from "@/business/__tests__/repository-contract";
import { ConstraintViolationError } from "@/business/repositories";

import { createTestDb, dbError } from "../__tests__/test-db";
import { createRepositories, createUnitOfWork } from ".";

// Every repository query runs here against better-sqlite3 – through the same
// migrations, proxy adapter and connection as the app. The test client
// rejects duplicate result column names, which the plugin would silently
// collapse (docs/data-model.md). The contract starts from an empty store,
// without the default categories.
describeRepositoryContract("Drizzle on better-sqlite3", async (clock) => {
  const { database } = await createTestDb({ defaultCategories: false });
  return {
    repositories: createRepositories(database.db, clock),
    unitOfWork: createUnitOfWork(database, clock),
  };
});

const NOW = new Date("2025-03-07T12:34:56.789Z");

async function setup() {
  const { database, sqlite } = await createTestDb({ defaultCategories: false });
  const repos = createRepositories(database.db, () => NOW);
  const category = await repos.categories.insert({
    name: "Umsatzerlöse",
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
    isSystem: true,
  });
  return { category, database, repos, sqlite };
}

describe("Drizzle repositories", () => {
  it("stores bookings in the documented column format", async () => {
    const { category, repos, sqlite } = await setup();
    const booking = await repos.bookings.insert({
      date: "2025-03-01",
      type: "income",
      grossCents: 11900,
      vatRate: null,
      netCents: 11900,
      vatCents: 0,
      categoryId: category.id,
      description: "Beratung",
      counterparty: "Kunde GmbH",
      reference: null,
      note: null,
      source: "stripe",
      externalId: "fee_1",
    });

    expect(sqlite.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id)).toEqual({
      id: booking.id,
      date: "2025-03-01",
      type: "income",
      gross_cents: 11900,
      vat_rate: null,
      net_cents: 11900,
      vat_cents: 0,
      category_id: category.id,
      description: "Beratung",
      counterparty: "Kunde GmbH",
      reference: null,
      note: null,
      source: "stripe",
      external_id: "fee_1",
      created_at: "2025-03-07T12:34:56.789Z",
      updated_at: "2025-03-07T12:34:56.789Z",
    });
    expect(sqlite.prepare("SELECT * FROM categories").all()).toEqual([
      {
        id: category.id,
        name: "Umsatzerlöse",
        type: "income",
        euer_position: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        reduces_income: 0,
        archived: 0,
        is_system: 1,
      },
    ]);
  });

  it("keeps the original SQLite error as cause of a constraint violation", async () => {
    const { repos } = await setup();
    const error = await repos.categories
      .insert({
        name: "Umsatzerlöse",
        type: "income",
        euerPosition: "X",
        reducesIncome: false,
        isSystem: false,
      })
      .catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(ConstraintViolationError);
    expect(await dbError(Promise.reject(error))).toMatch(
      /UNIQUE constraint failed: categories\.type, categories\.name/,
    );
  });

  it("passes CHECK violations through unchanged (services validate first)", async () => {
    const { category, repos } = await setup();
    const error = await repos.bookings
      .insert({
        date: "2025-02-30",
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
      })
      .catch((rejection: unknown) => rejection);

    expect(error).not.toBeInstanceOf(ConstraintViolationError);
    expect(await dbError(Promise.reject(error))).toMatch(
      /CHECK constraint failed: bookings_date_check/,
    );
  });

  it("rejects a booking with an empty external ID (CHECK)", async () => {
    const { category, repos } = await setup();
    const insert = repos.bookings.insert({
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
      source: "stripe",
      externalId: "",
    });
    expect(await dbError(insert)).toMatch(/bookings_external_id_check/);
  });
});
