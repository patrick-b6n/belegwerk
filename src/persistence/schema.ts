/**
 * Drizzle schema of the SQLite database (#9). Source of truth for the SQL
 * migrations in `./migrations` – after changing this file run
 * `pnpm db:generate` and commit the generated files.
 *
 * Design decisions (ids, dates, amounts, enums, constraints) are documented
 * in docs/data-model.md. The row types inferred from these tables stay in
 * src/persistence; business works with its own domain types (#11).
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Enum values as stored in the database. Business defines its own domain
// types (#11); repositories map between them.
export const BOOKING_TYPES = ["income", "expense"] as const;
export const VAT_RATES = ["0", "7", "19", "reverse_charge"] as const;
export const BOOKING_SOURCES = ["manual", "stripe"] as const;

/** `'a', 'b'` for use in CHECK constraints (values are constants, not user input). */
function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

/**
 * Unqualified column reference for CHECK constraints and index WHERE clauses.
 * Drizzle would otherwise emit `"bookings"."date"`. When a later migration
 * makes drizzle-kit rebuild the table, it creates `__new_bookings` with the
 * same constraint text, and a reference to `"bookings"` there fails.
 */
function col(column: { name: string }) {
  return sql.identifier(column.name);
}

/** Boolean stored as INTEGER 0/1 (Drizzle maps it to `boolean`). */
function flag(name: string) {
  return integer(name, { mode: "boolean" }).notNull().default(false);
}

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type", { enum: BOOKING_TYPES }).notNull(),
    /** Stable EÜR position key (#13), e.g. `BETRIEBSEINNAHMEN_UST_PFLICHTIG`. */
    euerPosition: text("euer_position").notNull(),
    /** Erlösminderung: the amount reduces income instead of counting as an expense. */
    reducesIncome: flag("reduces_income"),
    archived: flag("archived"),
    /** Predefined category (seed, #13); business restricts editing/deleting. */
    isSystem: flag("is_system"),
  },
  (t) => [
    uniqueIndex("categories_type_name_unique").on(t.type, t.name),
    check("categories_type_check", sql`${col(t.type)} IN (${sqlList(BOOKING_TYPES)})`),
    check("categories_reduces_income_check", sql`${col(t.reducesIncome)} IN (0, 1)`),
    check("categories_archived_check", sql`${col(t.archived)} IN (0, 1)`),
    check("categories_is_system_check", sql`${col(t.isSystem)} IN (0, 1)`),
    // Refunds are expenses in an Erlösminderung category (#1).
    check(
      "categories_reduces_income_expense_check",
      sql`${col(t.reducesIncome)} = 0 OR ${col(t.type)} = 'expense'`,
    ),
  ],
);

export const bookings = sqliteTable(
  "bookings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Payment date as ISO calendar date `YYYY-MM-DD`; its year is the EÜR year. */
    date: text("date").notNull(),
    type: text("type", { enum: BOOKING_TYPES }).notNull(),
    /** Gross amount in euro cents, always positive (#1). */
    grossCents: integer("gross_cents").notNull(),
    /** `null` = no VAT recorded (small business, §19 UStG). */
    vatRate: text("vat_rate", { enum: VAT_RATES }),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict", onUpdate: "restrict" }),
    description: text("description").notNull(),
    counterparty: text("counterparty").notNull(),
    reference: text("reference"),
    note: text("note"),
    /** Informational only; imported bookings are regular bookings (#1). */
    source: text("source", { enum: BOOKING_SOURCES }).notNull().default("manual"),
    /** ID in the source system (e.g. Stripe); used for duplicate detection. */
    externalId: text("external_id"),
    /** UTC timestamp, `Date#toISOString()` format (`2025-03-07T12:34:56.789Z`). */
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("bookings_date_idx").on(t.date),
    index("bookings_category_id_idx").on(t.categoryId),
    // Partial index: manual bookings without external ID never collide.
    // Note: Drizzle 0.45 renders `onConflictDoNothing({ target, where })`
    // against this index as invalid SQL (docs/data-model.md).
    uniqueIndex("bookings_source_external_id_unique")
      .on(t.source, t.externalId)
      .where(sql`${col(t.externalId)} IS NOT NULL`),
    // `date(x) IS x` rejects malformed and non-existent dates (2025-02-30
    // normalizes to 2025-03-02). `IS`, not `=`: a NULL result must fail.
    check(
      "bookings_date_check",
      sql`date(${col(t.date)}) IS ${col(t.date)} AND ${col(t.date)} >= '1000-01-01'`,
    ),
    check("bookings_type_check", sql`${col(t.type)} IN (${sqlList(BOOKING_TYPES)})`),
    check("bookings_vat_rate_check", sql`${col(t.vatRate)} IN (${sqlList(VAT_RATES)})`),
    check("bookings_source_check", sql`${col(t.source)} IN (${sqlList(BOOKING_SOURCES)})`),
    // Empty string would act as a real ID in the unique index above.
    check(
      "bookings_external_id_check",
      sql`${col(t.externalId)} IS NULL OR ${col(t.externalId)} <> ''`,
    ),
    // No STRICT tables in drizzle-kit: without typeof() SQLite would store 1.5
    // in an INTEGER column. Text like '100' is still converted to 100 by type
    // affinity before the check runs and is accepted.
    check(
      "bookings_gross_cents_check",
      sql`typeof(${col(t.grossCents)}) = 'integer' AND ${col(t.grossCents)} > 0`,
    ),
    check(
      "bookings_net_cents_check",
      sql`typeof(${col(t.netCents)}) = 'integer' AND ${col(t.netCents)} >= 0`,
    ),
    check(
      "bookings_vat_cents_check",
      sql`typeof(${col(t.vatCents)}) = 'integer' AND ${col(t.vatCents)} >= 0`,
    ),
    check(
      "bookings_amounts_check",
      sql`${col(t.netCents)} + ${col(t.vatCents)} = ${col(t.grossCents)}`,
    ),
    // Only 7 % and 19 % carry VAT; 0 %, reverse charge and "no rate" (NULL)
    // don't. coalesce: `NULL IN (...)` is NULL, which would pass the check.
    check(
      "bookings_vat_cents_rate_check",
      sql`${col(t.vatCents)} = 0 OR coalesce(${col(t.vatRate)}, '') IN ('7', '19')`,
    ),
  ],
);

export const taxYears = sqliteTable(
  "tax_years",
  {
    year: integer("year").primaryKey(),
    /** Kleinunternehmer (§19 UStG): no VAT rate is recorded for this year. */
    smallBusiness: flag("small_business"),
  },
  (t) => [
    check("tax_years_year_check", sql`${col(t.year)} BETWEEN 1000 AND 9999`),
    check("tax_years_small_business_check", sql`${col(t.smallBusiness)} IN (0, 1)`),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
