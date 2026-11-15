import { isTauri } from "@tauri-apps/api/core";

import { openDatabase } from "@/persistence/open-database";
import { createTauriSqlClient } from "@/persistence/tauri-sql-client";

import { type AppServices, createAppServices } from "./services";

/**
 * Why the start failed: no Tauri host (plain browser), the host could not
 * open the database file (cause in the host's log), or any other error.
 */
export type StartupFailureReason = "no-tauri" | "database-unavailable" | "error";

export class StartupError extends Error {
  readonly reason: StartupFailureReason;

  constructor(reason: StartupFailureReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StartupError";
    this.reason = reason;
  }
}

let started: Promise<AppServices> | undefined;

/**
 * Starts the app once: opens the database, applies pending migrations and
 * creates the services. Only call it in the WebView (from an effect) – the
 * SPA shell is prerendered in Node, where there is no Tauri.
 */
export function startApp(): Promise<AppServices> {
  started ??= start();
  return started;
}

async function start(): Promise<AppServices> {
  // `pnpm dev` in a plain browser: there is no database.
  if (!isTauri()) {
    throw new StartupError("no-tauri", "Tauri runtime not available (running in a plain browser?)");
  }
  try {
    const { database, applied } = await openDatabase(createTauriSqlClient());
    if (applied.length > 0) {
      console.info(`Applied migrations: ${applied.join(", ")}`);
    }
    const services = createAppServices(database);
    // Development builds only (own database, belegwerk-dev.db): fill an
    // empty database with sample bookings. Loaded lazily, so release builds
    // do not contain it.
    if (import.meta.env.DEV) {
      const { seedSampleData } = await import("./dev-sample-data");
      const result = await seedSampleData(services);
      if (result.seeded) console.info(`Sample data: ${result.created} bookings created`);
    }
    return services;
  } catch (error) {
    const reason = isDatabaseNotLoaded(error) ? "database-unavailable" : "error";
    throw new StartupError(reason, "Could not open the database", { cause: error });
  }
}

/**
 * The host registers the database at startup (src-tauri/src/lib.rs). If it
 * cannot open the file, it only logs the cause, and every query fails with
 * the plugin's "database sqlite:belegwerk.db not loaded".
 */
export function isDatabaseNotLoaded(error: unknown): boolean {
  for (let current: unknown = error; current !== undefined;) {
    const message = current instanceof Error ? current.message : String(current);
    if (/\bdatabase \S+ not loaded\b/i.test(message)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** Error with all its causes, one per line – shown on the error screen. */
export function describeError(error: unknown): string {
  const lines: string[] = [];
  for (let current: unknown = error; current !== undefined;) {
    lines.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines.join("\n");
}
