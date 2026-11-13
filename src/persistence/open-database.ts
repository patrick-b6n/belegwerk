import { loadMigrations } from "./bundled-migrations";
import { SqlConnection } from "./connection";
import { createDatabase, type Database } from "./database";
import { type MigrateOptions, migrate } from "./migrator";
import type { SqlClient } from "./sql-client";

export interface OpenDatabaseResult {
  database: Database;
  /** Tags of the migrations applied while opening. */
  applied: string[];
}

/**
 * Opens the database on `client`: applies all pending migrations and returns
 * the Drizzle-based {@link Database}. The app passes the Tauri client, tests a
 * `better-sqlite3` one – both take the same path.
 */
export async function openDatabase(
  client: SqlClient,
  options: MigrateOptions = {},
): Promise<OpenDatabaseResult> {
  const connection = new SqlConnection(client);
  await resetConnection(connection);
  const { applied } = await migrate(connection, await loadMigrations(), options);
  return { database: createDatabase(connection), applied };
}

/**
 * The connection lives in the Tauri host and survives a reload of the
 * WebView. A reload in the middle of a transaction would leave it open, and
 * the next `BEGIN` would fail – so roll back whatever is left.
 */
async function resetConnection(connection: SqlConnection) {
  try {
    await connection.execute("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/i.test(String(error))) {
      throw error;
    }
  }
}
