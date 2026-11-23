import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { bookingDayOf, startOfBookingDay } from "@/business/format";

import { createBetterSqlite3Client } from "./__tests__/better-sqlite3-client";
import { loadMigrations } from "./bundled-migrations";
import { SqlConnection } from "./connection";
import { migrate } from "./migrator";
import { createRepositories } from "./repositories";
import { openDatabase } from "./open-database";

/** A database as of 0001, with one booking per day in `days`. */
async function oldDatabase(days: readonly string[]) {
  const sqlite = new Database(":memory:");
  const connection = new SqlConnection(createBetterSqlite3Client(sqlite));
  await migrate(connection, (await loadMigrations()).slice(0, 2));
  const insert = sqlite.prepare(
    `INSERT INTO bookings (date, type, gross_cents, net_cents, vat_cents, category_id,
       description, counterparty, created_at, updated_at)
     VALUES (?, 'income', 100, 100, 0, 1, ?, 'Kunde', '', '')`,
  );
  for (const day of days) insert.run(day, day);
  return sqlite;
}

function stored(sqlite: Database.Database) {
  return sqlite.prepare("SELECT id, date, description AS day FROM bookings ORDER BY id").all() as {
    id: number;
    date: string;
    day: string;
  }[];
}

describe("migration 0002_booking_utc_timestamps", () => {
  it("converts every day since 1996 to 00:00 in Berlin", async () => {
    const days: string[] = [];
    for (let t = Date.UTC(1996, 0, 1); t < Date.UTC(2041, 0, 1); t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    const sqlite = await oldDatabase(days);
    await openDatabase(createBetterSqlite3Client(sqlite));
    const rows = stored(sqlite);
    expect(rows).toHaveLength(days.length);
    expect(rows.filter((row) => row.date !== startOfBookingDay(row.day))).toEqual([]);
  });

  it("keeps the day of earlier bookings", async () => {
    const days = ["1000-01-01", "1893-04-01", "1945-06-01", "1980-04-06", "1995-12-31"];
    const sqlite = await oldDatabase(days);
    await openDatabase(createBetterSqlite3Client(sqlite));
    expect(stored(sqlite).map((row) => bookingDayOf(row.date))).toEqual(days);
  });

  it("keeps ids, tax years and the id sequence, and converts the last import", async () => {
    const sqlite = await oldDatabase(["2024-12-31", "2025-01-01", "2025-07-01"]);
    sqlite.prepare("DELETE FROM bookings WHERE id = 3").run();
    sqlite.prepare("INSERT INTO settings VALUES ('stripe.lastImportTo', '2025-07-01')").run();
    const { database } = await openDatabase(createBetterSqlite3Client(sqlite));
    const repositories = createRepositories(database.db, () => new Date(0));

    expect(stored(sqlite).map((row) => [row.id, row.date])).toEqual([
      [1, "2024-12-30T23:00:00.000Z"],
      [2, "2024-12-31T23:00:00.000Z"],
    ]);
    expect(await repositories.bookings.listYears()).toEqual([2024, 2025]);
    const sums = await repositories.bookings.sumByCategoryAndVatRate(2025);
    expect(sums.map((group) => group.count)).toEqual([1]);
    const first = (await repositories.bookings.findById(1))!;
    expect(first.date).toBe("2024-12-31");
    expect((await repositories.bookings.insert(first)).id).toBe(4);
    expect(await repositories.settings.get("stripe.lastImportTo")).toBe("2025-06-30T22:00:00.000Z");
  });
});
