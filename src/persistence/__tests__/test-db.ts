import Database from "better-sqlite3";

import { openDatabase } from "../open-database";
import { createBetterSqlite3Client } from "./better-sqlite3-client";

/**
 * Fresh in-memory database with all committed migrations applied – through
 * the app's own path (#10): {@link openDatabase} with the migrator and the
 * Drizzle `sqlite-proxy` adapter, only the plugin is replaced by
 * `better-sqlite3`. One per test keeps tests isolated.
 *
 * - `db` / `database`: as the repositories get them in the app,
 * - `sqlite`: raw `better-sqlite3` handle for assertions.
 */
export async function createTestDb() {
  const sqlite = new Database(":memory:");
  const { database } = await openDatabase(createBetterSqlite3Client(sqlite));
  return { database, db: database.db, sqlite };
}

/**
 * Awaits a query that must fail and returns its error messages including all
 * causes – Drizzle wraps database errors in a `DrizzleQueryError` whose own
 * message only names the query.
 */
export async function dbError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const messages: string[] = [];
    for (let current: unknown = error; current !== undefined;) {
      messages.push(current instanceof Error ? current.message : String(current));
      current = current instanceof Error ? current.cause : undefined;
    }
    return messages.join("\n");
  }
  throw new Error("Expected the query to fail, but it succeeded");
}
