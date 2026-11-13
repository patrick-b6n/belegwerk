import { type ConstraintKind, ConstraintViolationError } from "@/business/repositories";

const PATTERNS: [RegExp, ConstraintKind][] = [
  [/UNIQUE constraint failed/i, "unique"],
  [/FOREIGN KEY constraint failed/i, "foreign_key"],
];

/**
 * Runs a repository query and turns unique/foreign-key violations into the
 * business {@link ConstraintViolationError}. Drizzle wraps the SQLite error
 * (`DrizzleQueryError` → `SqlError`), so the whole cause chain is searched.
 * Both the plugin (sqlx) and `better-sqlite3` pass on SQLite's own messages.
 *
 * Other errors (e.g. CHECK constraints, which services prevent by
 * validating) are rethrown unchanged.
 */
export async function mapConstraintErrors<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    for (let current: unknown = error; current !== undefined;) {
      const message = current instanceof Error ? current.message : String(current);
      const match = PATTERNS.find(([pattern]) => pattern.test(message));
      if (match) {
        throw new ConstraintViolationError(match[1], message, { cause: error });
      }
      current = current instanceof Error ? current.cause : undefined;
    }
    throw error;
  }
}
