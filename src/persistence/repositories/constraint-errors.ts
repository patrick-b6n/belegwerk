import { type ConstraintKind, ConstraintViolationError } from "@/business/repositories";

import { SqlError } from "../sql-client";

/** better-sqlite3 extended result codes (`error.code`). */
const DRIVER_CODES: Record<string, ConstraintKind> = {
  SQLITE_CONSTRAINT_UNIQUE: "unique",
  SQLITE_CONSTRAINT_PRIMARYKEY: "unique",
  SQLITE_CONSTRAINT_FOREIGNKEY: "foreign_key",
};

/**
 * Messages of the plugin (sqlx: `(code: 2067) UNIQUE constraint failed: …`)
 * and of SQLite itself. Extended codes: 2067 unique, 1555 primary key,
 * 787 foreign key.
 */
const PATTERNS: [RegExp, ConstraintKind][] = [
  [/\(code: (2067|1555)\)|\bUNIQUE constraint failed\b/, "unique"],
  [/\(code: 787\)|\bFOREIGN KEY constraint failed\b/, "foreign_key"],
];

/**
 * Runs a repository query and turns unique/foreign-key violations into the
 * business {@link ConstraintViolationError}.
 *
 * Only the database's own error is inspected: the {@link SqlError} raised by
 * our clients (message = SQLite message + SQL text with placeholders) and
 * its causes (the plugin's string, or the driver error with its `code`).
 * Drizzle's outer `DrizzleQueryError` is skipped – its message contains the
 * bound parameters, i.e. user input such as a booking note.
 *
 * Other errors (e.g. CHECK constraints, which services prevent by
 * validating) are rethrown unchanged.
 */
export async function mapConstraintErrors<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    const sqlError = findSqlError(error);
    const kind = sqlError && constraintKind(sqlError);
    if (sqlError && kind) {
      throw new ConstraintViolationError(kind, sqlError.message, { cause: error });
    }
    throw error;
  }
}

function findSqlError(error: unknown): SqlError | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof SqlError) return current;
  }
  return undefined;
}

function constraintKind(sqlError: SqlError): ConstraintKind | undefined {
  for (let current: unknown = sqlError; current !== undefined;) {
    const code = current instanceof Error ? (current as { code?: unknown }).code : undefined;
    if (typeof code === "string" && code in DRIVER_CODES) return DRIVER_CODES[code];
    const message = current instanceof Error ? current.message : String(current);
    const match = PATTERNS.find(([pattern]) => pattern.test(message));
    if (match) return match[1];
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}
