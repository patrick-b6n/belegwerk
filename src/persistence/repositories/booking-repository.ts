import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Booking, BookingInput } from "@/business/model";
import type { BookingRepository, Clock } from "@/business/repositories";

import type { Db } from "../database";
import { bookings } from "../schema";
import { mapConstraintErrors } from "./constraint-errors";

/**
 * SQLite allows at most 32766 bound parameters per statement (999 before
 * 3.32); chunks keep `IN (…)` lists well below either limit.
 */
const IN_LIST_CHUNK = 500;

/**
 * Drizzle implementation of {@link BookingRepository} on `db` – the app's
 * `Database.db` or the `tx` of a running transaction (unit of work).
 */
export function createBookingRepository(db: Db, clock: Clock): BookingRepository {
  return {
    findById: async (id) => {
      const row = await db.select().from(bookings).where(eq(bookings.id, id)).get();
      return row && toBooking(row);
    },

    insert: async (input) => {
      const now = clock().toISOString();
      const row = await mapConstraintErrors(() =>
        db
          .insert(bookings)
          .values({ ...toColumns(input), createdAt: now, updatedAt: now })
          .returning()
          .get(),
      );
      return toBooking(row);
    },

    update: async (id, input) => {
      const row = await mapConstraintErrors(() =>
        db
          .update(bookings)
          .set({ ...toColumns(input), updatedAt: clock().toISOString() })
          .where(eq(bookings.id, id))
          .returning()
          .get(),
      );
      return row && toBooking(row);
    },

    delete: async (id) => {
      const rows = await db
        .delete(bookings)
        .where(eq(bookings.id, id))
        .returning({ id: bookings.id });
      return rows.length > 0;
    },

    findExistingExternalIds: async (source, externalIds) => {
      const found = new Set<string>();
      const unique = [...new Set(externalIds)];
      for (let start = 0; start < unique.length; start += IN_LIST_CHUNK) {
        const rows = await db
          .select({ externalId: bookings.externalId })
          .from(bookings)
          .where(
            and(
              eq(bookings.source, source),
              inArray(bookings.externalId, unique.slice(start, start + IN_LIST_CHUNK)),
            ),
          );
        for (const { externalId } of rows) {
          if (externalId !== null) found.add(externalId);
        }
      }
      return found;
    },

    countByCategory: async (categoryId) => {
      const row = await db
        .select({ count: count() })
        .from(bookings)
        .where(eq(bookings.categoryId, categoryId))
        .get();
      return row?.count ?? 0;
    },

    countByCategories: async () => {
      const rows = await db
        .select({ categoryId: bookings.categoryId, count: count().as("booking_count") })
        .from(bookings)
        .groupBy(bookings.categoryId);
      return new Map(rows.map((row) => [row.categoryId, row.count]));
    },

    countVatRateUsage: async (year) => {
      // Range on the indexed date column (bookings_date_idx) instead of substr().
      const row = await db
        .select({ total: count(), withVatRate: count(bookings.vatRate) })
        .from(bookings)
        .where(
          and(gte(bookings.date, `${pad(year)}-01-01`), lte(bookings.date, `${pad(year)}-12-31`)),
        )
        .get();
      const total = row?.total ?? 0;
      const withVatRate = row?.withVatRate ?? 0;
      return { withVatRate, withoutVatRate: total - withVatRate };
    },

    listYears: async () => {
      // Dates are validated `YYYY-MM-DD` (CHECK), so the first four characters are the year.
      const year = sql<number>`cast(substr(${bookings.date}, 1, 4) AS integer)`;
      const rows = await db
        .selectDistinct({ year: year.as("year") })
        .from(bookings)
        .orderBy(year);
      return rows.map((row) => row.year);
    },

    list: async () => {
      const rows = await db.select().from(bookings).orderBy(desc(bookings.date), desc(bookings.id));
      return rows.map(toBooking);
    },
  };
}

/**
 * Four-digit year. ISO dates compare correctly as strings; the range stays
 * within the year (`year + 1` would give "10000-01-01" for 9999, which sorts
 * before "9999-…").
 */
function pad(year: number) {
  return String(year).padStart(4, "0");
}

function toColumns(input: BookingInput) {
  return {
    date: input.date,
    type: input.type,
    grossCents: input.grossCents,
    vatRate: input.vatRate,
    netCents: input.netCents,
    vatCents: input.vatCents,
    categoryId: input.categoryId,
    description: input.description,
    counterparty: input.counterparty,
    reference: input.reference,
    note: input.note,
    source: input.source,
    externalId: input.externalId,
  } satisfies Omit<typeof bookings.$inferInsert, "id" | "createdAt" | "updatedAt">;
}

function toBooking(row: typeof bookings.$inferSelect): Booking {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    grossCents: row.grossCents,
    vatRate: row.vatRate,
    netCents: row.netCents,
    vatCents: row.vatCents,
    categoryId: row.categoryId,
    description: row.description,
    counterparty: row.counterparty,
    reference: row.reference,
    note: row.note,
    source: row.source,
    externalId: row.externalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
