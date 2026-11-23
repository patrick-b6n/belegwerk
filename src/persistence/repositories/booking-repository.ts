import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import { textSearchCharClasses } from "@/business/bookings";
import { bookingDayOf, endOfBookingDay, startOfBookingDay } from "@/business/format";
import type { Booking, BookingInput } from "@/business/model";
import type {
  BookingFilter,
  BookingRepository,
  BookingSort,
  BookingSortField,
  BookingTextField,
  Clock,
} from "@/business/repositories";

import type { Db } from "../database";
import { bookings, categories } from "../schema";
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
          .set({
            ...toColumns(input),
            ...(input.bookedAt === undefined ? { date: keepTimeOfDay(input.date) } : {}),
            updatedAt: clock().toISOString(),
          })
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
      const row = await db
        .select({ total: count(), withVatRate: count(bookings.vatRate) })
        .from(bookings)
        .where(inYear(year))
        .get();
      const total = row?.total ?? 0;
      const withVatRate = row?.withVatRate ?? 0;
      return { withVatRate, withoutVatRate: total - withVatRate };
    },

    listYears: async () => {
      // SQLite has no time zones: the UTC year is the Berlin year except on
      // 31 Dec (UTC), where the exact time decides.
      const sample = sql<string>`case when substr(${bookings.date}, 6, 5) = '12-31' then ${bookings.date} else substr(${bookings.date}, 1, 4) end`;
      const rows = await db.selectDistinct({ sample: sample.as("year_sample") }).from(bookings);
      const years = new Set(
        rows.map(({ sample: value }) =>
          Number(value.length === 4 ? value : bookingDayOf(value).slice(0, 4)),
        ),
      );
      const sorted = [...years];
      sorted.sort((a, b) => a - b);
      return sorted;
    },

    search: async ({ filter, sort, limit, offset }) => {
      const query = db
        .select()
        .from(bookings)
        .where(filterCondition(filter))
        .orderBy(...orderBy(sort));
      const rows = limit === undefined ? await query : await query.limit(limit).offset(offset ?? 0);
      return rows.map(toBooking);
    },

    summarize: async (filter) => {
      const row = await db
        .select({
          count: count(),
          incomeCents: grossOf("income").as("income_cents"),
          expenseCents: grossOf("expense").as("expense_cents"),
        })
        .from(bookings)
        .where(filterCondition(filter))
        .get();
      return {
        count: row?.count ?? 0,
        incomeCents: row?.incomeCents ?? 0,
        expenseCents: row?.expenseCents ?? 0,
      };
    },

    sumByCategoryAndVatRate: async (year) => {
      const rows = await db
        .select({
          categoryId: bookings.categoryId,
          type: bookings.type,
          vatRate: bookings.vatRate,
          count: count().as("booking_count"),
          grossCents: sumOf(bookings.grossCents).as("gross_sum"),
          netCents: sumOf(bookings.netCents).as("net_sum"),
          vatCents: sumOf(bookings.vatCents).as("vat_sum"),
        })
        .from(bookings)
        .where(inYear(year))
        .groupBy(bookings.categoryId, bookings.type, bookings.vatRate)
        .orderBy(asc(bookings.categoryId), asc(bookings.type), asc(bookings.vatRate));
      return rows.map((row) => ({ ...row }));
    },

    listTextUsage: async (field) => {
      const column = TEXT_COLUMNS[field];
      // Grouped by the stored value (BINARY collation: exact, case-sensitive).
      const rows = await db
        .select({
          text: sql<string>`${column}`.as("usage_text"),
          type: bookings.type,
          count: count().as("usage_count"),
          lastDate: sql<string>`max(${bookings.date})`.as("last_date"),
        })
        .from(bookings)
        .groupBy(column, bookings.type)
        .orderBy(asc(bookings.type), asc(column));
      return rows.map((row) => ({ ...row, lastDate: bookingDayOf(row.lastDate) }));
    },
  };
}

const TEXT_COLUMNS = {
  description: bookings.description,
  counterparty: bookings.counterparty,
} as const satisfies Record<BookingTextField, SQLWrapper>;

/** Integer sum of a column within a group (groups are never empty, so never NULL). */
function sumOf(column: SQLWrapper) {
  return sql<number>`sum(${column})`.mapWith(Number);
}

function grossOf(type: "income" | "expense") {
  return sql<number>`coalesce(sum(case when ${bookings.type} = ${type} then ${bookings.grossCents} end), 0)`.mapWith(
    Number,
  );
}

/** WHERE condition of a {@link BookingFilter}; `undefined` matches everything. */
function filterCondition(filter: BookingFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (filter.text !== undefined) {
    const pattern = containsGlob(filter.text);
    // NULL reference/note: `NULL GLOB …` is NULL, which OR treats as false.
    conditions.push(
      or(
        ...[bookings.description, bookings.counterparty, bookings.reference, bookings.note].map(
          (column) => sql`${column} GLOB ${pattern}`,
        ),
      ),
    );
  }
  if (filter.dateFrom !== undefined) {
    conditions.push(gte(bookings.date, startOfBookingDay(filter.dateFrom)));
  }
  if (filter.dateTo !== undefined) {
    conditions.push(lt(bookings.date, endOfBookingDay(filter.dateTo)));
  }
  if (filter.type !== undefined) conditions.push(eq(bookings.type, filter.type));
  if (filter.categoryIds !== undefined) {
    // At most MAX_BOOKING_QUERY_CATEGORY_IDS (500): below SQLite's parameter limit.
    conditions.push(inArray(bookings.categoryId, [...filter.categoryIds]));
  }
  if (filter.source !== undefined) conditions.push(eq(bookings.source, filter.source));
  if (filter.vatRates !== undefined) {
    // `IN` never matches NULL, so "no rate" needs its own `IS NULL`.
    const rates = filter.vatRates.filter((rate) => rate !== null);
    const withoutRate = rates.length < filter.vatRates.length;
    conditions.push(
      or(
        rates.length > 0 ? inArray(bookings.vatRate, rates) : undefined,
        withoutRate ? isNull(bookings.vatRate) : undefined,
      ),
    );
  }
  if (filter.amountFrom !== undefined) conditions.push(gte(bookings.grossCents, filter.amountFrom));
  if (filter.amountTo !== undefined) conditions.push(lte(bookings.grossCents, filter.amountTo));
  return and(...conditions);
}

/**
 * `GLOB` pattern matching texts that contain `text`, case-insensitively per
 * character (`textSearchCharClasses`): `"Mü*"` → `*[Mm][üÜ][*]*`. GLOB
 * (unlike LIKE) is case-sensitive and supports character sets, also with
 * non-ASCII characters (UTF-8 aware). Its wildcards `*`, `?` and `[` are put
 * into a set of their own, so they match literally; `%` and `_` are literal
 * in GLOB anyway. Characters with case are never `]`, `^` or `-`, which
 * would have a special meaning inside a set.
 */
function containsGlob(text: string): string {
  const body = textSearchCharClasses(text)
    .map((variants) =>
      variants.length === 1 && !"*?[".includes(variants[0]!)
        ? variants[0]
        : `[${variants.join("")}]`,
    )
    .join("");
  return `*${body}*`;
}

/** Text columns sort case-insensitively for ASCII letters (see `BookingSort`). */
const SORT_EXPRESSIONS: Readonly<Record<BookingSortField, SQLWrapper>> = {
  date: bookings.date,
  description: sql`${bookings.description} COLLATE NOCASE`,
  counterparty: sql`${bookings.counterparty} COLLATE NOCASE`,
  // Subquery instead of a join: no duplicate column names.
  category: sql`(SELECT ${categories.name} FROM ${categories} WHERE ${categories.id} = ${bookings.categoryId}) COLLATE NOCASE`,
  netCents: bookings.netCents,
  vatCents: bookings.vatCents,
  grossCents: bookings.grossCents,
  type: bookings.type,
  source: bookings.source,
};

/** ORDER BY with the tie-breakers of `BookingSort`: a total order, stable across pages. */
function orderBy({ field, direction }: BookingSort): SQL[] {
  const order = direction === "asc" ? asc : desc;
  if (field === "date") return [order(bookings.date), order(bookings.id)];
  return [order(SORT_EXPRESSIONS[field]), desc(bookings.date), desc(bookings.id)];
}

/**
 * Bookings of a tax year (calendar year in Europe/Berlin) as a range on the
 * indexed column; UTC timestamps of one format compare correctly as strings.
 */
function inYear(year: number): SQL | undefined {
  const padded = String(year).padStart(4, "0");
  return and(
    gte(bookings.date, startOfBookingDay(`${padded}-01-01`)),
    lt(bookings.date, endOfBookingDay(`${padded}-12-31`)),
  );
}

/** The stored time if it is on `day` already, otherwise the start of `day`. */
function keepTimeOfDay(day: string): SQL {
  const start = startOfBookingDay(day);
  return sql`case when ${bookings.date} >= ${start} and ${bookings.date} < ${endOfBookingDay(day)} then ${bookings.date} else ${start} end`;
}

function toColumns(input: BookingInput) {
  return {
    date: input.bookedAt ?? startOfBookingDay(input.date),
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
    date: bookingDayOf(row.date),
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
