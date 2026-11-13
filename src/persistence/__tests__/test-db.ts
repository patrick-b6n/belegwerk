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
  // The app must enable this per connection as well (#10).
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}
