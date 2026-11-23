import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BackupCheckError, writeDatabaseBackup } from "./backup";
import { SqlConnection } from "./connection";
import { openDatabase } from "./open-database";
import { createBetterSqlite3Client } from "./__tests__/better-sqlite3-client";
import { createTestDb } from "./__tests__/test-db";
import type { SqlClient, SqlRow, SqlValue } from "./sql-client";

let dir: string;

beforeEach(() => {
  // Spaces and umlauts in the directory: paths are bound, never quoted into SQL.
  dir = mkdtempSync(join(tmpdir(), "belegwerk Sicherung äöü ß-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Test DB with one booking, so the backup has data beyond the seeded categories. */
async function setup() {
  const test = await createTestDb();
  const categoryId = (
    test.sqlite.prepare("SELECT id FROM categories WHERE type = 'income' LIMIT 1").get() as {
      id: number;
    }
  ).id;
  insertBooking(test.sqlite, categoryId, "Beratung 'Müller'; DROP TABLE bookings");
  return { ...test, categoryId };
}

function insertBooking(sqlite: Database.Database, categoryId: number, description: string) {
  sqlite
    .prepare(
      `INSERT INTO bookings (date, type, gross_cents, net_cents, vat_cents, vat_rate, category_id,
         description, counterparty, source, created_at, updated_at)
       VALUES ('2025-02-28T23:00:00.000Z', 'income', 11900, 10000, 1900, '19', ?, ?, 'Kunde', 'manual',
         '2025-03-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z')`,
    )
    .run(categoryId, description);
}

/** Every table with all rows, as the backup must reproduce it. */
function dump(sqlite: Database.Database) {
  const tables = (
    sqlite
      .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all() as { name: string; sql: string }[]
  ).filter((table) => table.name !== "sqlite_sequence");
  return {
    schema: sqlite.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all(),
    rows: Object.fromEntries(
      tables.map((table) => [
        table.name,
        sqlite.prepare(`SELECT * FROM "${table.name}" ORDER BY rowid`).all(),
      ]),
    ),
  };
}

function openBackup(path: string) {
  return new Database(path, { readonly: true, fileMustExist: true });
}

describe("Database.backupTo (VACUUM INTO)", () => {
  it("writes a database with the same schema and data", async () => {
    const { database, sqlite } = await setup();
    const path = join(dir, "belegwerk-backup 2026-11-14_1530 Jörg.db");

    await database.backupTo(path);

    const backup = openBackup(path);
    try {
      expect(dump(backup)).toEqual(dump(sqlite));
      expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(backup.pragma("journal_mode", { simple: true })).toBe("delete");
      const bookings = backup.prepare("SELECT description FROM bookings").all();
      expect(bookings).toEqual([{ description: "Beratung 'Müller'; DROP TABLE bookings" }]);
    } finally {
      backup.close();
    }
  });

  it("writes into an existing empty file", async () => {
    const { database, sqlite } = await setup();
    const path = join(dir, "leer.db");
    writeFileSync(path, "");

    await database.backupTo(path);

    const backup = openBackup(path);
    try {
      expect(dump(backup)).toEqual(dump(sqlite));
    } finally {
      backup.close();
    }
  });

  it("refuses an existing backup as target and leaves it unchanged", async () => {
    // The caller (src/app) truncates the picked file first.
    const { database } = await setup();
    const path = join(dir, "alt.db");
    await database.backupTo(path);
    const old = readFileSync(path);

    await expect(database.backupTo(path)).rejects.toThrow(/output file already exists/);
    expect(readFileSync(path)).toEqual(old);
  });

  it("refuses any other non-empty file and leaves it unchanged", async () => {
    const { database } = await setup();
    const path = join(dir, "notiz.txt");
    writeFileSync(path, "old content");

    // SQLite reads the file as a database first: "file is not a database".
    await expect(database.backupTo(path)).rejects.toThrow(/not a database|already exists/);
    expect(readFileSync(path, "utf8")).toBe("old content");
  });

  it("fails for a directory that does not exist", async () => {
    const { database } = await setup();
    await expect(database.backupTo(join(dir, "fehlt", "x.db"))).rejects.toThrow(/unable to open/);
  });

  it("detaches the check database again, so backups can be repeated", async () => {
    const { database, sqlite, categoryId } = await setup();
    await database.backupTo(join(dir, "1.db"));
    insertBooking(sqlite, categoryId, "Zweite");
    await database.backupTo(join(dir, "2.db"));

    expect(sqlite.prepare("PRAGMA database_list").all()).not.toContainEqual(
      expect.objectContaining({ name: "backup_check" }),
    );
    const second = openBackup(join(dir, "2.db"));
    try {
      expect(second.prepare("SELECT count(*) AS n FROM bookings").get()).toEqual({ n: 2 });
    } finally {
      second.close();
    }
    expect(statSync(join(dir, "1.db")).size).toBeGreaterThan(0);
  });

  it("waits for a running transaction and contains its committed writes", async () => {
    const { database, categoryId } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const transaction = database.transaction(async (tx) => {
      await tx.run(
        // Raw SQL through Drizzle: the second booking of the test.
        sqlInsertBooking(categoryId),
      );
      entered();
      await gate;
    });
    await inside;
    const path = join(dir, "während.db");
    // Queued behind the transaction: VACUUM would fail inside it.
    const backup = database.backupTo(path);
    release();
    await transaction;
    await backup;

    const copy = openBackup(path);
    try {
      expect(copy.prepare("SELECT count(*) AS n FROM bookings").get()).toEqual({ n: 2 });
    } finally {
      copy.close();
    }
  });
});

/** Client that answers like SQLite, with a `quick_check` result of choice. */
function fakeClient(quickCheck: string[], counts: { main: number; copy: number }) {
  const statements: { sql: string; params: readonly SqlValue[] | undefined }[] = [];
  const client: SqlClient = {
    execute: async (text, params) => {
      statements.push({ sql: text, params });
      return { rowsAffected: 0, lastInsertId: 0 };
    },
    select: async (text, params): Promise<SqlRow[]> => {
      statements.push({ sql: text, params });
      if (text.includes("quick_check")) return quickCheck.map((value) => ({ quick_check: value }));
      if (text.includes("main.sqlite_schema")) return [{ count: counts.main }];
      return [{ count: counts.copy }];
    },
  };
  return { client, statements };
}

describe("Database.mainFilePath", () => {
  it("returns the path of the database file", async () => {
    const path = join(dir, "belegwerk.db");
    const sqlite = new Database(path);
    try {
      const { database } = await openDatabase(createBetterSqlite3Client(sqlite));
      expect(await database.mainFilePath()).toBe(path);
    } finally {
      sqlite.close();
    }
  });

  it("is empty for an in-memory database", async () => {
    const { database } = await createTestDb();
    expect(await database.mainFilePath()).toBe("");
  });
});

describe("writeDatabaseBackup – leftovers", () => {
  it("works with a transaction left open and a check database left attached", async () => {
    const { database, sqlite } = await setup();
    const other = join(dir, "anderes.db");
    new Database(other).close();
    sqlite.prepare("ATTACH DATABASE ? AS backup_check").run(other);
    sqlite.exec("BEGIN");

    const path = join(dir, "trotzdem.db");
    await database.backupTo(path);

    expect(sqlite.inTransaction).toBe(false);
    expect(sqlite.prepare("PRAGMA database_list").all()).not.toContainEqual(
      expect.objectContaining({ name: "backup_check" }),
    );
    const copy = openBackup(path);
    try {
      expect(copy.prepare("SELECT count(*) AS n FROM bookings").get()).toEqual({ n: 1 });
    } finally {
      copy.close();
    }
  });
});

describe("writeDatabaseBackup – check", () => {
  it("binds the path and detaches after a successful check", async () => {
    const { client, statements } = fakeClient(["ok"], { main: 9, copy: 9 });
    await writeDatabaseBackup(new SqlConnection(client), "C:\\a b\\ä'.db");
    expect(statements.map((statement) => statement.sql)).toEqual([
      "ROLLBACK",
      "VACUUM INTO ?",
      "DETACH DATABASE backup_check",
      "ATTACH DATABASE ? AS backup_check",
      "PRAGMA backup_check.quick_check",
      "SELECT count(*) AS count FROM main.sqlite_schema",
      "SELECT count(*) AS count FROM backup_check.sqlite_schema",
      "DETACH DATABASE backup_check",
    ]);
    expect(statements[1]?.params).toEqual(["C:\\a b\\ä'.db"]);
    expect(statements[3]?.params).toEqual(["C:\\a b\\ä'.db"]);
  });

  it("fails if quick_check reports problems, and detaches", async () => {
    const { client, statements } = fakeClient(["*** in database backup_check ***", "page 3"], {
      main: 9,
      copy: 9,
    });
    const error = await writeDatabaseBackup(new SqlConnection(client), "x.db").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BackupCheckError);
    expect(statements.at(-1)?.sql).toBe("DETACH DATABASE backup_check");
  });

  it("fails if the copy lacks schema objects (e.g. an empty file)", async () => {
    const { client, statements } = fakeClient(["ok"], { main: 9, copy: 0 });
    await expect(writeDatabaseBackup(new SqlConnection(client), "x.db")).rejects.toThrow(
      BackupCheckError,
    );
    expect(statements.at(-1)?.sql).toBe("DETACH DATABASE backup_check");
  });
});

function sqlInsertBooking(categoryId: number) {
  return sql`INSERT INTO bookings (date, type, gross_cents, net_cents, vat_cents, vat_rate,
    category_id, description, counterparty, source, created_at, updated_at)
    VALUES ('2025-03-31T22:00:00.000Z', 'income', 100, 100, 0, '0', ${categoryId}, 'Im Lauf', 'Kunde',
      'manual', '2025-04-01T00:00:00.000Z', '2025-04-01T00:00:00.000Z')`;
}
