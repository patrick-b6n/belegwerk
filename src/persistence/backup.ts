import { rollbackQuietly, type SqlConnection } from "./connection";
import type { SqlClient } from "./sql-client";

/** Schema name under which the written backup is attached for the check. */
const CHECK_SCHEMA = "backup_check";

/**
 * Writes a consistent copy of the database to `path` (backup, #32) and
 * checks it.
 *
 * - `VACUUM INTO ?`: SQLite itself writes a compacted, transactionally
 *   consistent copy (one file, no journal). The path is a bound parameter,
 *   never part of the SQL text.
 * - Runs in an {@link SqlConnection.exclusive} section: `VACUUM` must not run
 *   inside a transaction, and no other flow may start one in between.
 * - The target must not exist or must be an **empty** file – otherwise SQLite
 *   refuses with "output file already exists". Replacing an existing file is
 *   the caller's job (the app truncates the file the user picked first,
 *   src/app/tauri-database-backup.ts).
 * - Check: the copy is attached on the same connection; `PRAGMA quick_check`
 *   must report `ok` and it must contain as many schema objects as the
 *   source (an empty file would pass `quick_check`). Detached afterwards,
 *   also after a failure.
 *
 * @throws `SqlError` if SQLite cannot write the file (e.g. directory not
 *   writable, target not empty), {@link BackupCheckError} if the check fails.
 */
export async function writeDatabaseBackup(connection: SqlConnection, path: string): Promise<void> {
  await connection.exclusive(async (client) => {
    // VACUUM fails inside a transaction. None is open between exclusive
    // sections; this only guards against one left over (e.g. a WebView reload).
    await rollbackQuietly(client);
    await client.execute("VACUUM INTO ?", [path]);
    await checkBackup(client, path);
  });
}

export class BackupCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupCheckError";
  }
}

async function checkBackup(client: SqlClient, path: string): Promise<void> {
  // Defensive: a check database left attached (e.g. a failed DETACH) would
  // make the ATTACH fail.
  await client.execute(`DETACH DATABASE ${CHECK_SCHEMA}`).catch(() => undefined);
  await client.execute(`ATTACH DATABASE ? AS ${CHECK_SCHEMA}`, [path]);
  try {
    await checkAttached(client);
  } catch (error) {
    // Detach anyway; the check's error is the one to report.
    await client.execute(`DETACH DATABASE ${CHECK_SCHEMA}`).catch(() => undefined);
    throw error;
  }
  await client.execute(`DETACH DATABASE ${CHECK_SCHEMA}`);
}

async function checkAttached(client: SqlClient): Promise<void> {
  const check = await client.select(`PRAGMA ${CHECK_SCHEMA}.quick_check`);
  const messages = check.map((row) => String(Object.values(row)[0]));
  if (messages.length !== 1 || messages[0] !== "ok") {
    throw new BackupCheckError(`quick_check of the backup failed: ${messages.join("; ")}`);
  }
  const source = await countSchemaObjects(client, "main");
  const copy = await countSchemaObjects(client, CHECK_SCHEMA);
  if (source !== copy) {
    throw new BackupCheckError(`The backup has ${copy} schema objects, the database ${source}`);
  }
}

async function countSchemaObjects(client: SqlClient, schema: string): Promise<number> {
  const [row] = await client.select(`SELECT count(*) AS count FROM ${schema}.sqlite_schema`);
  return Number(row?.count);
}

/**
 * Path of the database file of the connection (`PRAGMA database_list`, row
 * `main`): what the backup guard compares the target with. Empty for an
 * in-memory database.
 */
export async function databaseFilePath(connection: SqlConnection): Promise<string> {
  const rows = await connection.select("PRAGMA database_list");
  const main = rows.find((row) => row.name === "main");
  if (!main) throw new Error("PRAGMA database_list returned no main database");
  return String(main.file ?? "");
}
