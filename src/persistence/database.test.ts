import Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createBetterSqlite3Client } from "./__tests__/better-sqlite3-client";
import { createTestDb, dbError } from "./__tests__/test-db";
import { SqlConnection } from "./connection";
import { openDatabase } from "./open-database";
import { settings } from "./schema";

const countSettings = async (db: Awaited<ReturnType<typeof createTestDb>>["db"]) =>
  (await db.select({ n: count() }).from(settings).get())?.n;

describe("Database.transaction", () => {
  it("commits when the callback resolves", async () => {
    const { database, db } = await createTestDb();
    const result = await database.transaction(async (tx) => {
      await tx.insert(settings).values({ key: "a", value: "1" });
      await tx.insert(settings).values({ key: "b", value: "2" });
      return "done";
    });
    expect(result).toBe("done");
    expect(await countSettings(db)).toBe(2);
  });

  it("rolls back and rethrows when the callback rejects", async () => {
    const { database, db } = await createTestDb();
    const failure = database.transaction(async (tx) => {
      await tx.insert(settings).values({ key: "a", value: "1" });
      await tx.insert(settings).values({ key: "a", value: "duplicate" });
    });
    expect(await dbError(failure)).toMatch(/UNIQUE/);
    expect(await countSettings(db)).toBe(0);
  });

  it("keeps queries of other flows out of the transaction", async () => {
    const { database, db } = await createTestDb();
    let insertDone!: () => void;
    const inserted = new Promise<void>((resolve) => {
      insertDone = resolve;
    });

    const transaction = database.transaction(async (tx) => {
      await tx.insert(settings).values({ key: "a", value: "1" });
      insertDone();
      // Give the outer query below every chance to run in between.
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("abort");
    });
    await inserted;
    // Issued while the transaction is open: must wait and must not see (or
    // become part of) the rolled-back insert.
    const outside = countSettings(db);

    await expect(transaction).rejects.toThrow("abort");
    expect(await outside).toBe(0);
  });

  it("rejects Drizzle's own db.transaction()", async () => {
    const { db } = await createTestDb();
    expect(await dbError(db.transaction(async () => undefined))).toMatch(/Database\.transaction/);
  });
});

describe("db.batch", () => {
  it("is atomic", async () => {
    const { db } = await createTestDb();
    const failure = db.batch([
      db.insert(settings).values({ key: "a", value: "1" }),
      db.insert(settings).values({ key: "a", value: "duplicate" }),
    ]);
    expect(await dbError(failure)).toMatch(/UNIQUE/);
    expect(await countSettings(db)).toBe(0);
  });

  it("returns the results of all queries", async () => {
    const { db } = await createTestDb();
    const [, rows] = await db.batch([
      db.insert(settings).values({ key: "a", value: "1" }),
      db.select().from(settings).where(eq(settings.key, "a")),
    ]);
    expect(rows).toEqual([{ key: "a", value: "1" }]);
  });
});

describe("openDatabase", () => {
  it("rolls back a transaction left open (e.g. by a WebView reload)", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("BEGIN; CREATE TABLE leftover (id INTEGER);");

    await openDatabase(createBetterSqlite3Client(sqlite));
    expect(sqlite.inTransaction).toBe(false);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'leftover'").all()).toEqual(
      [],
    );
  });

  it("leaves foreign keys on", async () => {
    const { sqlite } = await createTestDb();
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("better-sqlite3 test client", () => {
  it("rejects duplicate result column names (the plugin would drop values)", async () => {
    const client = createBetterSqlite3Client(new Database(":memory:"));
    await expect(client.select("SELECT 1 AS id, 2 AS id")).rejects.toThrow(/Duplicate/);
  });
});

describe("SqlConnection", () => {
  it("runs exclusive sections one after another", async () => {
    const connection = new SqlConnection(createBetterSqlite3Client(new Database(":memory:")));
    const events: string[] = [];
    const first = connection.exclusive(async () => {
      events.push("first start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("first end");
    });
    const second = connection.exclusive(async () => {
      events.push("second");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first start", "first end", "second"]);
  });

  it("continues after a failed section", async () => {
    const connection = new SqlConnection(createBetterSqlite3Client(new Database(":memory:")));
    await expect(connection.exclusive(() => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(connection.select("SELECT 1 AS one")).resolves.toEqual([{ one: 1 }]);
  });

  it("reports a call that waits too long for the connection (deadlock hint)", async () => {
    const waits: number[] = [];
    const connection = new SqlConnection(createBetterSqlite3Client(new Database(":memory:")), {
      slowWaitMs: 20,
      onSlowWait: (waited) => waits.push(waited),
    });
    let release!: () => void;
    const section = connection.exclusive(() => new Promise<void>((resolve) => (release = resolve)));
    // Like using the outer connection inside the section: has to wait.
    const waiting = connection.select("SELECT 1 AS one");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(waits).toEqual([20]);

    release();
    await section;
    await expect(waiting).resolves.toEqual([{ one: 1 }]);
  });

  it("does not report calls that get the connection in time", async () => {
    const waits: number[] = [];
    const connection = new SqlConnection(createBetterSqlite3Client(new Database(":memory:")), {
      slowWaitMs: 20,
      onSlowWait: (waited) => waits.push(waited),
    });
    await Promise.all([
      connection.exclusive(() => new Promise((resolve) => setTimeout(resolve, 5))),
      connection.select("SELECT 1"),
      connection.select("SELECT 2"),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(waits).toEqual([]);
  });

  it("rejects using the section's client after it ended", async () => {
    const connection = new SqlConnection(createBetterSqlite3Client(new Database(":memory:")));
    const leaked = await connection.exclusive(async (client) => client);
    await expect(leaked.select("SELECT 1")).rejects.toThrow(/after its exclusive section/);
  });
});
