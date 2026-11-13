import type Database from "better-sqlite3";

import { type SqlClient, SqlError, type SqlRow } from "../sql-client";

/**
 * {@link SqlClient} on top of `better-sqlite3`, behaving like
 * `tauri-plugin-sql`: rows as objects keyed by column name, errors as
 * {@link SqlError}. Unlike the plugin it rejects results with duplicate column
 * names – there the plugin would silently drop values (drizzle-proxy.ts).
 */
export function createBetterSqlite3Client(sqlite: Database.Database): SqlClient {
  return {
    execute: async (sql, params = []) => {
      const result = wrap(sql, () => sqlite.prepare(sql).run(...params));
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
    },
    select: async (sql, params = []) =>
      wrap(sql, () => {
        const statement = sqlite.prepare(sql);
        if (!statement.reader) {
          statement.run(...params);
          return [];
        }
        const names = statement.columns().map((column) => column.name);
        const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
        if (duplicates.length > 0) {
          throw new Error(
            `Duplicate result column names (${duplicates.join(", ")}) – tauri-plugin-sql would drop values; alias them`,
          );
        }
        return statement.all(...params) as SqlRow[];
      }),
  };
}

function wrap<T>(sql: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SqlError(`${message} (SQL: ${sql.trim().slice(0, 200)})`, { cause: error });
  }
}
