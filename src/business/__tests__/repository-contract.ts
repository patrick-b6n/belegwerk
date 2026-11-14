import { beforeEach, describe, expect, it } from "vitest";

import type { BookingInput, CategoryInput } from "../model";
import {
  type BookingFilter,
  type BookingSort,
  type Clock,
  type ConstraintKind,
  ConstraintViolationError,
  type Repositories,
  type UnitOfWork,
} from "../repositories";

/**
 * Behaviour every implementation of the repository interfaces shares (#11).
 * Runs against the in-memory fakes (`in-memory-repositories.test.ts`) and the
 * Drizzle implementations on `better-sqlite3`
 * (`src/persistence/repositories/repositories.test.ts`), so the fakes cannot
 * drift from the real thing.
 *
 * `setup` creates a fresh, empty store whose repositories use `clock`.
 */
export function describeRepositoryContract(
  name: string,
  setup: (clock: Clock) => Promise<{ repositories: Repositories; unitOfWork: UnitOfWork }>,
) {
  describe(`repository contract: ${name}`, () => {
    let repos: Repositories;
    let unitOfWork: UnitOfWork;
    let now: Date;

    const tick = (iso: string) => {
      now = new Date(iso);
    };

    beforeEach(async () => {
      now = new Date(T1);
      ({ repositories: repos, unitOfWork } = await setup(() => now));
    });

    const insertCategory = (overrides: Partial<CategoryInput> = {}) =>
      repos.categories.insert({ ...INCOME_CATEGORY, ...overrides });

    async function insertBooking(overrides: Partial<BookingInput> = {}) {
      const categoryId =
        overrides.categoryId ??
        (await repos.categories.list()).find((category) => category.type === "income")?.id ??
        (await insertCategory()).id;
      return repos.bookings.insert({ ...booking(categoryId), ...overrides });
    }

    /** A booking without VAT (gross = net), so any amount passes the CHECKs. */
    async function add(overrides: Partial<BookingInput> = {}) {
      const grossCents = overrides.grossCents ?? 1000;
      return insertBooking({
        vatRate: "0",
        ...amounts(grossCents),
        reference: null,
        note: null,
        ...overrides,
      });
    }

    describe("bookings", () => {
      it("inserts a booking with id and timestamps from the clock", async () => {
        const category = await insertCategory();
        const inserted = await repos.bookings.insert(booking(category.id));

        expect(inserted).toEqual({
          ...booking(category.id),
          id: expect.any(Number),
          createdAt: T1,
          updatedAt: T1,
        });
        expect(await repos.bookings.findById(inserted.id)).toEqual(inserted);
      });

      it("round-trips all fields, including null and every VAT rate", async () => {
        const category = await insertCategory();
        for (const vatRate of [null, "0", "reverse_charge"] as const) {
          const input: BookingInput = {
            ...booking(category.id),
            vatRate,
            netCents: 11900,
            vatCents: 0,
            reference: null,
            note: null,
            externalId: null,
          };
          const inserted = await repos.bookings.insert(input);
          expect(await repos.bookings.findById(inserted.id)).toEqual({
            ...input,
            ...ids(inserted),
          });
        }
        const expense = await insertCategory({ name: "Software", type: "expense" });
        const input: BookingInput = {
          ...booking(expense.id),
          type: "expense",
          vatRate: "7",
          grossCents: 1070,
          netCents: 1000,
          vatCents: 70,
          source: "stripe",
          externalId: "fr_1",
        };
        const inserted = await repos.bookings.insert(input);
        expect(await repos.bookings.findById(inserted.id)).toEqual({ ...input, ...ids(inserted) });
      });

      it("returns undefined for an unknown id", async () => {
        expect(await repos.bookings.findById(4711)).toBeUndefined();
      });

      it("never reuses ids of deleted bookings", async () => {
        const first = await insertBooking();
        const second = await insertBooking();
        expect(second.id).toBeGreaterThan(first.id);
        await repos.bookings.delete(second.id);
        expect((await insertBooking()).id).toBeGreaterThan(second.id);
      });

      it("replaces all fields on update, keeping createdAt", async () => {
        const inserted = await insertBooking({ reference: "R-1", note: "Notiz" });
        const other = await insertCategory({ name: "Sonstiges" });
        tick(T2);
        const input: BookingInput = {
          ...booking(other.id),
          date: "2026-01-02",
          grossCents: 500,
          netCents: 500,
          vatCents: 0,
          vatRate: "0",
          description: "Geändert",
          counterparty: "Jemand",
          reference: null,
          note: null,
          source: "stripe",
          externalId: "fee_9",
        };

        const updated = await repos.bookings.update(inserted.id, input);

        expect(updated).toEqual({ ...input, id: inserted.id, createdAt: T1, updatedAt: T2 });
        expect(await repos.bookings.findById(inserted.id)).toEqual(updated);
      });

      it("returns undefined when updating an unknown booking", async () => {
        const category = await insertCategory();
        expect(await repos.bookings.update(4711, booking(category.id))).toBeUndefined();
      });

      it("deletes a booking", async () => {
        const inserted = await insertBooking();
        expect(await repos.bookings.delete(inserted.id)).toBe(true);
        expect(await repos.bookings.findById(inserted.id)).toBeUndefined();
        expect(await repos.bookings.delete(inserted.id)).toBe(false);
      });

      it("rejects an unknown category", async () => {
        await expectConstraint(repos.bookings.insert(booking(4711)), "foreign_key");
        const inserted = await insertBooking();
        await expectConstraint(repos.bookings.update(inserted.id, booking(4711)), "foreign_key");
        expect(await repos.bookings.findById(inserted.id)).toEqual(inserted);
      });

      it("classifies constraint errors by the database error, not by user input", async () => {
        // The bound parameters appear in Drizzle's outer error message.
        await expectConstraint(
          insertBooking({ categoryId: 4711, note: "UNIQUE constraint failed" }),
          "foreign_key",
        );
        await insertBooking({ source: "stripe", externalId: "fee_1" });
        const error = await insertBooking({
          source: "stripe",
          externalId: "fee_1",
          note: "FOREIGN KEY constraint failed geheim",
        }).catch((rejection: unknown) => rejection);
        expect(error).toBeInstanceOf(ConstraintViolationError);
        expect((error as ConstraintViolationError).kind).toBe("unique");
        // The message does not leak bound parameters.
        expect((error as Error).message).not.toMatch(/geheim/);
      });

      it("rejects a duplicate external ID per source", async () => {
        await insertBooking({ source: "stripe", externalId: "fee_1" });
        await expectConstraint(insertBooking({ source: "stripe", externalId: "fee_1" }), "unique");
        // Other source, or no external ID at all: no conflict.
        await insertBooking({ source: "manual", externalId: "fee_1" });
        await insertBooking({ externalId: null });
        await insertBooking({ externalId: null });

        const other = await insertBooking({ source: "stripe", externalId: "fee_2" });
        await expectConstraint(
          repos.bookings.update(other.id, {
            ...booking(other.categoryId),
            source: "stripe",
            externalId: "fee_1",
          }),
          "unique",
        );
        // Keeping its own external ID is fine.
        expect(
          await repos.bookings.update(other.id, {
            ...booking(other.categoryId),
            ...pickIds(other),
          }),
        ).toMatchObject({ source: "stripe", externalId: "fee_2" });
      });

      it("finds existing external IDs of a source", async () => {
        await insertBooking({ source: "stripe", externalId: "fee_1" });
        await insertBooking({ source: "stripe", externalId: "fr_1" });
        await insertBooking({ source: "manual", externalId: "fee_2" });
        await insertBooking({ externalId: null });

        expect(await repos.bookings.findExistingExternalIds("stripe", [])).toEqual(new Set());
        expect(
          await repos.bookings.findExistingExternalIds("stripe", [
            "fee_1",
            "fee_2",
            "fee_3",
            "fee_1",
          ]),
        ).toEqual(new Set(["fee_1"]));
        expect(await repos.bookings.findExistingExternalIds("manual", ["fee_2", "fr_1"])).toEqual(
          new Set(["fee_2"]),
        );
      });

      it("finds existing external IDs among many", async () => {
        const many = Array.from({ length: 1234 }, (_, index) => `fee_${index}`);
        await insertBooking({ source: "stripe", externalId: "fee_0" });
        await insertBooking({ source: "stripe", externalId: "fee_777" });
        await insertBooking({ source: "stripe", externalId: "fee_1233" });

        expect(await repos.bookings.findExistingExternalIds("stripe", many)).toEqual(
          new Set(["fee_0", "fee_777", "fee_1233"]),
        );
      });

      it("counts bookings by category", async () => {
        const a = await insertCategory({ name: "A" });
        const b = await insertCategory({ name: "B" });
        await insertBooking({ categoryId: a.id });
        await insertBooking({ categoryId: a.id });
        await insertBooking({ categoryId: b.id });

        expect(await repos.bookings.countByCategory(a.id)).toBe(2);
        expect(await repos.bookings.countByCategory(b.id)).toBe(1);
        expect(await repos.bookings.countByCategory(4711)).toBe(0);
      });

      it("counts bookings of all categories at once", async () => {
        expect(await repos.bookings.countByCategories()).toEqual(new Map());
        const a = await insertCategory({ name: "A" });
        const b = await insertCategory({ name: "B" });
        const unused = await insertCategory({ name: "C" });
        await insertBooking({ categoryId: a.id });
        await insertBooking({ categoryId: a.id });
        await insertBooking({ categoryId: b.id });

        const counts = await repos.bookings.countByCategories();
        expect(counts).toEqual(
          new Map([
            [a.id, 2],
            [b.id, 1],
          ]),
        );
        expect(counts.has(unused.id)).toBe(false);
      });

      it("counts bookings of a year with and without VAT rate", async () => {
        const noRate = { vatRate: null, netCents: 11900, vatCents: 0 } as const;
        await insertBooking({ date: "2024-12-31" });
        await insertBooking({ date: "2025-01-01" });
        await insertBooking({ date: "2025-06-15", ...noRate });
        await insertBooking({ date: "2025-12-31", vatRate: "reverse_charge", ...amounts(11900) });
        await insertBooking({ date: "2025-12-31", ...noRate });
        await insertBooking({ date: "2025-12-31", ...noRate });
        await insertBooking({ date: "2026-01-01", ...noRate });

        expect(await repos.bookings.countVatRateUsage(2025)).toEqual({
          withVatRate: 2,
          withoutVatRate: 3,
        });
        expect(await repos.bookings.countVatRateUsage(2023)).toEqual({
          withVatRate: 0,
          withoutVatRate: 0,
        });
      });

      it("lists the distinct years of the booking dates in ascending order", async () => {
        expect(await repos.bookings.listYears()).toEqual([]);
        await insertBooking({ date: "2025-12-31" });
        await insertBooking({ date: "1000-01-01" });
        await insertBooking({ date: "2025-01-01" });
        await insertBooking({ date: "9999-12-31" });
        await insertBooking({ date: "2024-06-15" });

        expect(await repos.bookings.listYears()).toEqual([1000, 2024, 2025, 9999]);
      });

      it("counts bookings of the year 9999", async () => {
        await insertBooking({ date: "9998-12-31" });
        await insertBooking({ date: "9999-01-01" });
        await insertBooking({ date: "9999-12-31", vatRate: null, ...amounts(11900) });

        expect(await repos.bookings.countVatRateUsage(9999)).toEqual({
          withVatRate: 1,
          withoutVatRate: 1,
        });
      });

      it("sums a year's bookings by category, type and VAT rate", async () => {
        expect(await repos.bookings.sumByCategoryAndVatRate(2025)).toEqual([]);
        const sales = await insertCategory({ name: "Umsatz" });
        const office = await insertCategory({
          name: "Büro",
          type: "expense",
          euerPosition: "ARBEITSMITTEL",
        });
        const refund = await insertCategory({
          name: "Erstattung",
          type: "expense",
          reducesIncome: true,
        });
        const noRate = { vatRate: null, netCents: 500, vatCents: 0, grossCents: 500 } as const;
        // Outside the year.
        await insertBooking({ categoryId: sales.id, date: "2024-12-31" });
        await insertBooking({ categoryId: sales.id, date: "2026-01-01" });
        // 19 %: per-booking amounts are summed as stored (not recomputed from gross).
        await insertBooking({ categoryId: sales.id, date: "2025-01-01" });
        await insertBooking({
          categoryId: sales.id,
          date: "2025-12-31",
          grossCents: 1,
          netCents: 1,
          vatCents: 0,
        });
        await insertBooking({ categoryId: sales.id, date: "2025-06-01", ...noRate });
        await insertBooking({ categoryId: sales.id, date: "2025-06-02", ...noRate });
        await insertBooking({
          categoryId: sales.id,
          date: "2025-06-03",
          vatRate: "reverse_charge",
          ...amounts(2000),
        });
        await insertBooking({
          categoryId: sales.id,
          date: "2025-06-04",
          vatRate: "0",
          ...amounts(300),
        });
        await insertBooking({
          categoryId: sales.id,
          date: "2025-06-05",
          vatRate: "7",
          grossCents: 107,
          netCents: 100,
          vatCents: 7,
        });
        await insertBooking({
          categoryId: office.id,
          type: "expense",
          date: "2025-02-01",
          ...amounts(800),
          vatRate: "0",
        });
        await insertBooking({ categoryId: refund.id, type: "expense", date: "2025-03-01" });

        expect(await repos.bookings.sumByCategoryAndVatRate(2025)).toEqual([
          {
            categoryId: sales.id,
            type: "income",
            vatRate: null,
            count: 2,
            grossCents: 1000,
            netCents: 1000,
            vatCents: 0,
          },
          {
            categoryId: sales.id,
            type: "income",
            vatRate: "0",
            count: 1,
            grossCents: 300,
            netCents: 300,
            vatCents: 0,
          },
          {
            categoryId: sales.id,
            type: "income",
            vatRate: "19",
            count: 2,
            grossCents: 11901,
            netCents: 10001,
            vatCents: 1900,
          },
          {
            categoryId: sales.id,
            type: "income",
            vatRate: "7",
            count: 1,
            grossCents: 107,
            netCents: 100,
            vatCents: 7,
          },
          {
            categoryId: sales.id,
            type: "income",
            vatRate: "reverse_charge",
            count: 1,
            grossCents: 2000,
            netCents: 2000,
            vatCents: 0,
          },
          {
            categoryId: office.id,
            type: "expense",
            vatRate: "0",
            count: 1,
            grossCents: 800,
            netCents: 800,
            vatCents: 0,
          },
          {
            categoryId: refund.id,
            type: "expense",
            vatRate: "19",
            count: 1,
            grossCents: 11900,
            netCents: 10000,
            vatCents: 1900,
          },
        ]);
        expect(await repos.bookings.sumByCategoryAndVatRate(2023)).toEqual([]);
      });

      it("groups a mismatched booking type separately and sums the year 9999", async () => {
        const category = await insertCategory();
        await insertBooking({ categoryId: category.id, date: "9999-12-31" });
        await insertBooking({ categoryId: category.id, date: "9999-01-01", type: "expense" });

        expect(await repos.bookings.sumByCategoryAndVatRate(9999)).toEqual([
          expect.objectContaining({ categoryId: category.id, type: "expense", count: 1 }),
          expect.objectContaining({ categoryId: category.id, type: "income", count: 1 }),
        ]);
      });

      it("sums large amounts exactly", async () => {
        const category = await insertCategory();
        const max = 10_000_000_000;
        for (let index = 0; index < 3; index += 1) {
          await insertBooking({
            categoryId: category.id,
            date: "2025-05-05",
            vatRate: "0",
            ...amounts(max - index),
          });
        }
        const [group] = await repos.bookings.sumByCategoryAndVatRate(2025);
        expect(group).toMatchObject({ count: 3, grossCents: 3 * max - 3, netCents: 3 * max - 3 });
        expect(Number.isInteger(group?.grossCents)).toBe(true);
      });
    });

    describe("booking search", () => {
      const NEWEST: BookingSort = { field: "date", direction: "desc" };

      const search = async (
        filter: BookingFilter = {},
        sort: BookingSort = NEWEST,
        window: { limit?: number; offset?: number } = {},
      ) => (await repos.bookings.search({ filter, sort, ...window })).map((found) => found.id);

      const sorted = async (field: BookingSort["field"]) => ({
        asc: await search({}, { field, direction: "asc" }),
        desc: await search({}, { field, direction: "desc" }),
      });

      it("finds nothing in an empty store", async () => {
        expect(await search()).toEqual([]);
        expect(await repos.bookings.summarize({})).toEqual({
          count: 0,
          incomeCents: 0,
          expenseCents: 0,
        });
      });

      it("returns all bookings by date descending, then id descending, as complete copies", async () => {
        const older = await add({ date: "2025-01-31" });
        const sameDayFirst = await add({ date: "2025-03-07" });
        const newest = await add({ date: "2026-01-01" });
        const sameDaySecond = await add({ date: "2025-03-07", description: "Zweite" });
        const oldest = await add({ date: "1999-12-31" });

        expect(await search()).toEqual([
          newest.id,
          sameDaySecond.id,
          sameDayFirst.id,
          older.id,
          oldest.id,
        ]);
        expect(await search({}, { field: "date", direction: "asc" })).toEqual([
          oldest.id,
          older.id,
          sameDayFirst.id,
          sameDaySecond.id,
          newest.id,
        ]);

        const [found] = await repos.bookings.search({ filter: {}, sort: NEWEST });
        // Complete domain objects, equal to what findById returns …
        expect(found).toEqual(await repos.bookings.findById(newest.id));
        // … and copies that do not change the stored bookings.
        (found as { description: string }).description = "Verändert";
        expect(await repos.bookings.findById(newest.id)).toEqual(newest);
      });

      it("searches description, counterparty, reference and note", async () => {
        const description = await add({ description: "Webdesign Relaunch" });
        const counterparty = await add({ counterparty: "Agentur Relaunch GmbH" });
        const reference = await add({ reference: "RELAUNCH-7" });
        const note = await add({ note: "Zweite Rate\nfür den Relaunch" });
        await add({ description: "Hosting", counterparty: "Provider", externalId: "relaunch" });

        expect(await search({ text: "relaunch" })).toEqual([
          note.id,
          reference.id,
          counterparty.id,
          description.id,
        ]);
        expect(await search({ text: "Rate\nfür" })).toEqual([note.id]);
        expect(await search({ text: "nicht vorhanden" })).toEqual([]);
      });

      it("searches case-insensitively, also umlauts and ß", async () => {
        const lower = await add({ counterparty: "müller gmbh" });
        const upper = await add({ counterparty: "MÜLLER GMBH" });
        const mixed = await add({ description: "Beratung Müller" });
        const street = await add({ note: "Hauptstraße 1" });
        const capitalSharpS = await add({ note: "HAUPTSTRAẞE 2" });
        await add({ counterparty: "Mueller AG" });

        for (const text of ["Müller", "MÜLLER", "müller", "mÜlLeR"]) {
          expect(await search({ text })).toEqual([mixed.id, upper.id, lower.id]);
        }
        for (const text of ["straße", "STRAẞE", "Straße"]) {
          expect(await search({ text })).toEqual([capitalSharpS.id, street.id]);
        }
        expect(await search({ text: "Ü" })).toEqual([mixed.id, upper.id, lower.id]);
        // Other scripts, also outside the BMP (4-byte UTF-8 in SQLite).
        const greek = await add({ description: "ΣΟΦΙΑ 𐐀" });
        expect(await search({ text: "σοφια 𐐨" })).toEqual([greek.id]);
      });

      it("treats wildcard characters in the text literally", async () => {
        const percent = await add({ description: "Rabatt 10% netto" });
        const underscore = await add({ reference: "RE_2025" });
        const star = await add({ description: "Sternchen * Hinweis" });
        const question = await add({ description: "Warum? Darum" });
        const bracket = await add({ note: "Liste [a-z] und ]" });
        await add({ description: "Rabatt 100 netto", reference: "RE-2025" });

        expect(await search({ text: "10%" })).toEqual([percent.id]);
        expect(await search({ text: "%" })).toEqual([percent.id]);
        expect(await search({ text: "E_2" })).toEqual([underscore.id]);
        expect(await search({ text: "_" })).toEqual([underscore.id]);
        expect(await search({ text: "*" })).toEqual([star.id]);
        expect(await search({ text: "?" })).toEqual([question.id]);
        expect(await search({ text: "[a-z]" })).toEqual([bracket.id]);
        expect(await search({ text: "]" })).toEqual([bracket.id]);
        expect(await search({ text: "\\" })).toEqual([]);
      });

      it("filters by date range, inclusive", async () => {
        const first = await add({ date: "2025-01-01" });
        const middle = await add({ date: "2025-06-15" });
        const last = await add({ date: "2025-12-31" });
        const after = await add({ date: "2026-01-01" });

        expect(await search({ dateFrom: "2025-01-01", dateTo: "2025-12-31" })).toEqual([
          last.id,
          middle.id,
          first.id,
        ]);
        expect(await search({ dateFrom: "2025-06-15" })).toEqual([after.id, last.id, middle.id]);
        expect(await search({ dateTo: "2025-06-15" })).toEqual([middle.id, first.id]);
        expect(await search({ dateFrom: "2025-06-15", dateTo: "2025-06-15" })).toEqual([middle.id]);
      });

      it("filters by type, categories and source", async () => {
        const consulting = await insertCategory({ name: "Beratung" });
        const sales = await insertCategory({ name: "Verkauf" });
        const phone = await insertCategory({ name: "Telefon", type: "expense" });
        const a = await add({ categoryId: consulting.id });
        const b = await add({ categoryId: sales.id, source: "stripe", externalId: "ch_1" });
        const c = await add({ categoryId: phone.id, type: "expense" });
        const d = await add({ categoryId: phone.id, type: "expense", source: "stripe" });

        expect(await search({ type: "income" })).toEqual([b.id, a.id]);
        expect(await search({ type: "expense" })).toEqual([d.id, c.id]);
        expect(await search({ categoryIds: [consulting.id] })).toEqual([a.id]);
        expect(await search({ categoryIds: [phone.id, sales.id] })).toEqual([d.id, c.id, b.id]);
        expect(await search({ categoryIds: [4711] })).toEqual([]);
        expect(await search({ source: "stripe" })).toEqual([d.id, b.id]);
        expect(await search({ source: "manual" })).toEqual([c.id, a.id]);
      });

      it("filters by gross amount range, inclusive", async () => {
        const small = await add({ grossCents: 999 });
        const lower = await add({ grossCents: 1000 });
        const upper = await add({ grossCents: 5000 });
        const large = await add({ grossCents: 5001 });

        expect(await search({ amountFrom: 1000, amountTo: 5000 })).toEqual([upper.id, lower.id]);
        expect(await search({ amountFrom: 5000 })).toEqual([large.id, upper.id]);
        expect(await search({ amountTo: 999 })).toEqual([small.id]);
        expect(await search({ amountFrom: 0, amountTo: 0 })).toEqual([]);
      });

      it("combines all filters with AND", async () => {
        const phone = await insertCategory({ name: "Telefon", type: "expense" });
        const base = {
          date: "2025-05-05",
          type: "expense",
          categoryId: phone.id,
          source: "manual",
          grossCents: 2500,
          counterparty: "Telekom",
        } as const;
        const hit = await add(base);
        await add({ ...base, date: "2025-07-01" });
        await add({ ...base, type: "income" });
        await add({ ...base, categoryId: (await insertCategory({ name: "Andere" })).id });
        await add({ ...base, source: "stripe" });
        await add({ ...base, grossCents: 2600 });
        await add({ ...base, counterparty: "Vodafone" });

        const filter: BookingFilter = {
          text: "telekom",
          dateFrom: "2025-05-01",
          dateTo: "2025-05-31",
          type: "expense",
          categoryIds: [phone.id],
          source: "manual",
          amountFrom: 2000,
          amountTo: 2500,
        };
        expect(await search(filter)).toEqual([hit.id]);
        expect(await repos.bookings.summarize(filter)).toEqual({
          count: 1,
          incomeCents: 0,
          expenseCents: 2500,
        });
      });

      it("sums gross amounts of all matching bookings by type", async () => {
        const phone = await insertCategory({ name: "Telefon", type: "expense" });
        await add({ grossCents: 11900, date: "2025-01-10" });
        await add({ grossCents: 100, date: "2025-02-10" });
        await add({ grossCents: 2500, type: "expense", categoryId: phone.id, date: "2025-02-11" });
        await add({ grossCents: 10_000_000_000, date: "2026-01-01" });

        expect(await repos.bookings.summarize({})).toEqual({
          count: 4,
          incomeCents: 10_000_012_000,
          expenseCents: 2500,
        });
        expect(await repos.bookings.summarize({ dateTo: "2025-12-31" })).toEqual({
          count: 3,
          incomeCents: 12000,
          expenseCents: 2500,
        });
        expect(await repos.bookings.summarize({ type: "expense" })).toEqual({
          count: 1,
          incomeCents: 0,
          expenseCents: 2500,
        });
        expect(await repos.bookings.summarize({ text: "nicht vorhanden" })).toEqual({
          count: 0,
          incomeCents: 0,
          expenseCents: 0,
        });
      });

      it("sorts by every field, breaking ties by date and id descending", async () => {
        const zulu = await insertCategory({ name: "zulu" });
        const alpha = await insertCategory({ name: "Alpha" });
        const umlaut = await insertCategory({ name: "Ärger", type: "expense" });
        const a = await add({
          date: "2025-01-01",
          categoryId: zulu.id,
          description: "beta",
          counterparty: "Zeta",
          grossCents: 300,
        });
        const b = await add({
          date: "2025-02-01",
          categoryId: alpha.id,
          description: "Alpha",
          counterparty: "ähnlich",
          grossCents: 100,
          source: "stripe",
        });
        const c = await add({
          date: "2025-02-01",
          categoryId: umlaut.id,
          type: "expense",
          description: "Beta",
          counterparty: "zeta",
          vatRate: "19",
          grossCents: 119,
          netCents: 100,
          vatCents: 19,
        });
        const d = await add({
          date: "2024-12-31",
          categoryId: alpha.id,
          description: "gamma",
          counterparty: "Ypsilon",
          grossCents: 300,
        });

        // Ties (same value) always keep date desc, id desc – in both directions.
        expect(await sorted("date")).toEqual({
          asc: [d.id, a.id, b.id, c.id],
          desc: [c.id, b.id, a.id, d.id],
        });
        // ASCII case-insensitive ("beta" = "Beta"), ties by date/id.
        expect(await sorted("description")).toEqual({
          asc: [b.id, c.id, a.id, d.id],
          desc: [d.id, c.id, a.id, b.id],
        });
        // Umlauts sort after z (code point order).
        expect(await sorted("counterparty")).toEqual({
          asc: [d.id, c.id, a.id, b.id],
          desc: [b.id, c.id, a.id, d.id],
        });
        expect(await sorted("category")).toEqual({
          asc: [b.id, d.id, a.id, c.id],
          desc: [c.id, a.id, b.id, d.id],
        });
        expect(await sorted("grossCents")).toEqual({
          asc: [b.id, c.id, a.id, d.id],
          desc: [a.id, d.id, c.id, b.id],
        });
        expect(await sorted("netCents")).toEqual({
          asc: [c.id, b.id, a.id, d.id],
          desc: [a.id, d.id, c.id, b.id],
        });
        expect(await sorted("vatCents")).toEqual({
          asc: [b.id, a.id, d.id, c.id],
          desc: [c.id, b.id, a.id, d.id],
        });
        expect(await sorted("type")).toEqual({
          asc: [c.id, b.id, a.id, d.id],
          desc: [b.id, a.id, d.id, c.id],
        });
        expect(await sorted("source")).toEqual({
          asc: [c.id, a.id, d.id, b.id],
          desc: [b.id, c.id, a.id, d.id],
        });
      });

      it("returns windows of the sorted result", async () => {
        const newestFirst: number[] = [];
        for (let day = 1; day <= 7; day += 1) {
          newestFirst.unshift((await add({ date: `2025-03-0${day}` })).id);
        }

        expect(await search({}, NEWEST, { limit: 3 })).toEqual(newestFirst.slice(0, 3));
        expect(await search({}, NEWEST, { limit: 3, offset: 3 })).toEqual(newestFirst.slice(3, 6));
        expect(await search({}, NEWEST, { limit: 3, offset: 6 })).toEqual(newestFirst.slice(6));
        expect(await search({}, NEWEST, { limit: 3, offset: 7 })).toEqual([]);
        expect(await search({}, NEWEST, { limit: 100 })).toEqual(newestFirst);
        expect(await search({ dateFrom: "2025-03-04" }, NEWEST, { limit: 2, offset: 2 })).toEqual(
          newestFirst.slice(2, 4),
        );
        // Sums cover all matching bookings, not a window.
        expect((await repos.bookings.summarize({})).count).toBe(7);
      });
    });

    describe("categories", () => {
      it("inserts unarchived categories and lists all by id", async () => {
        const a = await insertCategory({ name: "Umsätze" });
        const b = await insertCategory({
          name: "Rückerstattungen",
          type: "expense",
          euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
          reducesIncome: true,
          isSystem: true,
        });
        await repos.categories.setArchived(a.id, true);

        expect(b).toEqual({
          id: expect.any(Number),
          name: "Rückerstattungen",
          type: "expense",
          euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
          reducesIncome: true,
          archived: false,
          isSystem: true,
        });
        expect(await repos.categories.list()).toEqual([{ ...a, archived: true }, b]);
        expect(await repos.categories.findById(b.id)).toEqual(b);
        expect(await repos.categories.findById(4711)).toBeUndefined();
      });

      it("rejects a duplicate name per type (case-sensitive)", async () => {
        await insertCategory({ name: "Software" });
        await expectConstraint(insertCategory({ name: "Software" }), "unique");
        await insertCategory({ name: "Software", type: "expense" });
        await insertCategory({ name: "software" });
        expect(await repos.categories.list()).toHaveLength(3);
      });

      it("updates only the given fields", async () => {
        const category = await insertCategory({ name: "Alt", type: "expense" });

        expect(await repos.categories.update(category.id, { name: "Neu" })).toEqual({
          ...category,
          name: "Neu",
        });
        const changed = { euerPosition: "SONSTIGE", reducesIncome: true };
        expect(await repos.categories.update(category.id, changed)).toEqual({
          ...category,
          ...changed,
          name: "Neu",
        });
        expect(await repos.categories.update(category.id, {})).toEqual({
          ...category,
          ...changed,
          name: "Neu",
        });
        expect(await repos.categories.update(category.id, { name: undefined })).toMatchObject({
          name: "Neu",
        });
        expect(await repos.categories.update(4711, { name: "X" })).toBeUndefined();
        expect(await repos.categories.update(4711, {})).toBeUndefined();
      });

      it("rejects renaming to an existing name", async () => {
        await insertCategory({ name: "A" });
        const b = await insertCategory({ name: "B" });
        await expectConstraint(repos.categories.update(b.id, { name: "A" }), "unique");
        expect(await repos.categories.findById(b.id)).toEqual(b);
      });

      it("rejects reducesIncome on income categories (raw CHECK error, services validate)", async () => {
        expect(await errorChain(insertCategory({ type: "income", reducesIncome: true }))).toMatch(
          /categories_reduces_income_expense_check/,
        );
        const income = await insertCategory({ type: "income" });
        expect(
          await errorChain(repos.categories.update(income.id, { reducesIncome: true })),
        ).toMatch(/categories_reduces_income_expense_check/);
        expect(await repos.categories.list()).toEqual([income]);
      });

      it("archives and reactivates", async () => {
        const category = await insertCategory();
        expect(await repos.categories.setArchived(category.id, true)).toEqual({
          ...category,
          archived: true,
        });
        expect(await repos.categories.setArchived(category.id, false)).toEqual(category);
        expect(await repos.categories.setArchived(4711, true)).toBeUndefined();
      });

      it("deletes only categories without bookings", async () => {
        const used = await insertCategory({ name: "Benutzt" });
        const unused = await insertCategory({ name: "Unbenutzt" });
        await insertBooking({ categoryId: used.id });

        await expectConstraint(repos.categories.delete(used.id), "foreign_key");
        expect(await repos.categories.findById(used.id)).toEqual(used);

        expect(await repos.categories.delete(unused.id)).toBe(true);
        expect(await repos.categories.delete(unused.id)).toBe(false);
        expect(await repos.categories.list()).toEqual([used]);
      });
    });

    describe("tax years", () => {
      it("creates, replaces and lists tax years in ascending order", async () => {
        expect(await repos.taxYears.find(2025)).toBeUndefined();
        expect(await repos.taxYears.list()).toEqual([]);

        expect(await repos.taxYears.upsert({ year: 2026, smallBusiness: true })).toEqual({
          year: 2026,
          smallBusiness: true,
        });
        await repos.taxYears.upsert({ year: 2025, smallBusiness: true });
        expect(await repos.taxYears.upsert({ year: 2026, smallBusiness: false })).toEqual({
          year: 2026,
          smallBusiness: false,
        });

        expect(await repos.taxYears.find(2026)).toEqual({ year: 2026, smallBusiness: false });
        expect(await repos.taxYears.list()).toEqual([
          { year: 2025, smallBusiness: true },
          { year: 2026, smallBusiness: false },
        ]);
      });
    });

    describe("settings", () => {
      it("gets, sets, overwrites and deletes values", async () => {
        expect(await repos.settings.get("stripe.key")).toBeUndefined();
        await repos.settings.set("stripe.key", "rk_test_1");
        await repos.settings.set("other", "");
        expect(await repos.settings.get("stripe.key")).toBe("rk_test_1");
        await repos.settings.set("stripe.key", "rk_test_2");
        expect(await repos.settings.get("stripe.key")).toBe("rk_test_2");
        expect(await repos.settings.get("other")).toBe("");

        expect(await repos.settings.delete("stripe.key")).toBe(true);
        expect(await repos.settings.get("stripe.key")).toBeUndefined();
        expect(await repos.settings.delete("stripe.key")).toBe(false);
      });
    });

    describe("unit of work", () => {
      it("commits all writes and returns the result", async () => {
        const result = await unitOfWork.run(async (tx) => {
          const category = await tx.categories.insert(INCOME_CATEGORY);
          const inserted = await tx.bookings.insert(booking(category.id));
          await tx.settings.set("last", "1");
          await tx.taxYears.upsert({ year: 2025, smallBusiness: true });
          // Reads inside see the transaction's own writes.
          expect(await tx.bookings.findById(inserted.id)).toEqual(inserted);
          return inserted.id;
        });

        expect(await repos.bookings.findById(result)).toBeDefined();
        expect(await repos.settings.get("last")).toBe("1");
        expect(await repos.taxYears.find(2025)).toEqual({ year: 2025, smallBusiness: true });
      });

      it("rolls back all writes and rethrows when the callback rejects", async () => {
        const existing = await insertCategory({ name: "Bestand" });
        const failure = new Error("abort");

        await expect(
          unitOfWork.run(async (tx) => {
            await tx.categories.insert({ ...INCOME_CATEGORY, name: "Neu" });
            await tx.categories.update(existing.id, { name: "Umbenannt" });
            await tx.bookings.insert(booking(existing.id));
            await tx.settings.set("last", "1");
            await tx.taxYears.upsert({ year: 2025, smallBusiness: true });
            throw failure;
          }),
        ).rejects.toBe(failure);

        expect(await repos.categories.list()).toEqual([existing]);
        expect(await repos.bookings.countByCategory(existing.id)).toBe(0);
        expect(await repos.settings.get("last")).toBeUndefined();
        expect(await repos.taxYears.list()).toEqual([]);
      });

      it("reuses an id handed out in a rolled-back unit of work", async () => {
        const committed = await insertBooking();
        const category = (await repos.categories.list())[0]!;
        let rolledBackId = 0;
        await expect(
          unitOfWork.run(async (tx) => {
            rolledBackId = (await tx.bookings.insert(booking(category.id))).id;
            throw new Error("abort");
          }),
        ).rejects.toThrow("abort");

        expect(rolledBackId).toBeGreaterThan(committed.id);
        expect((await insertBooking()).id).toBe(rolledBackId);
      });

      it("rolls back earlier writes when a constraint fails", async () => {
        await insertBooking({ source: "stripe", externalId: "fee_1" });
        const category = (await repos.categories.list())[0]!;

        await expectConstraint(
          unitOfWork.run(async (tx) => {
            await tx.bookings.insert({
              ...booking(category.id),
              source: "stripe",
              externalId: "fee_2",
            });
            await tx.bookings.insert({
              ...booking(category.id),
              source: "stripe",
              externalId: "fee_1",
            });
          }),
          "unique",
        );

        expect(await repos.bookings.findExistingExternalIds("stripe", ["fee_1", "fee_2"])).toEqual(
          new Set(["fee_1"]),
        );
      });
    });
  });
}

async function expectConstraint(promise: Promise<unknown>, kind: ConstraintKind) {
  const error = await promise.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(ConstraintViolationError);
  expect((error as ConstraintViolationError).kind).toBe(kind);
}

/** Messages of the rejection and all its causes (Drizzle wraps database errors). */
async function errorChain(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("Expected a rejection");
    },
    (rejection: unknown) => rejection,
  );
  const messages: string[] = [];
  for (let current: unknown = error; current !== undefined;) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join("\n");
}

const T1 = "2025-03-07T12:34:56.789Z";
const T2 = "2025-04-01T08:00:00.000Z";

const INCOME_CATEGORY: CategoryInput = {
  name: "Umsatzerlöse",
  type: "income",
  euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
  reducesIncome: false,
  isSystem: false,
};

/** A valid income booking (19 %) in `categoryId`. */
function booking(categoryId: number): BookingInput {
  return {
    date: "2025-03-01",
    type: "income",
    grossCents: 11900,
    vatRate: "19",
    netCents: 10000,
    vatCents: 1900,
    categoryId,
    description: "Beratung",
    counterparty: "Kunde GmbH",
    reference: "RE-2025-001",
    note: "Erste Rate",
    source: "manual",
    externalId: null,
  };
}

/** Amounts without VAT. */
function amounts(grossCents: number) {
  return { grossCents, netCents: grossCents, vatCents: 0 };
}

function ids(stored: { id: number; createdAt: string; updatedAt: string }) {
  return { id: stored.id, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
}

function pickIds(input: BookingInput) {
  return { source: input.source, externalId: input.externalId };
}
