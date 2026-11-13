import type { Clock, Repositories, UnitOfWork } from "@/business/repositories";

import type { Database, Db } from "../database";
import { createBookingRepository } from "./booking-repository";
import { createCategoryRepository } from "./category-repository";
import { createSettingsRepository } from "./settings-repository";
import { createTaxYearRepository } from "./tax-year-repository";

/**
 * All repositories on one Drizzle instance: the app's `Database.db` (each
 * query on its own) or the `tx` of a running transaction.
 */
export function createRepositories(db: Db, clock: Clock): Repositories {
  return {
    bookings: createBookingRepository(db, clock),
    categories: createCategoryRepository(db),
    taxYears: createTaxYearRepository(db),
    settings: createSettingsRepository(db),
  };
}

/**
 * {@link UnitOfWork} on {@link Database.transaction}: the callback gets
 * repositories bound to the transaction's `tx`. Repositories on
 * `database.db` would wait for the transaction to end – deadlock
 * (docs/architecture.md).
 */
export function createUnitOfWork(database: Database, clock: Clock): UnitOfWork {
  return {
    run: (fn) => database.transaction((tx) => fn(createRepositories(tx, clock))),
  };
}
