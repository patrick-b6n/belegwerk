import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";

import * as schema from "../schema";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Fresh in-memory database with all committed migrations applied – the same
 * SQL files the app runs at startup (#10). One per test keeps tests isolated.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle({ client: sqlite, schema });
  // Same protocol as the app's migrator (#10, docs/data-model.md): foreign
  // keys off around the migration transaction (table rebuilds need it; the
  // pragma is ignored inside a transaction), check, then on for good.
  // better-sqlite3 enables foreign keys by default.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder });
  const violations = sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`Foreign key violations after migration: ${JSON.stringify(violations)}`);
  }
  sqlite.pragma("foreign_keys = ON");
  return { db, sqlite };
}
