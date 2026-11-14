import { describe, expect, it } from "vitest";

import {
  createFakeStripeClient,
  stripeFee,
  stripeFeeRefund,
} from "../__tests__/fake-stripe-client";
import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import type { Booking, CategoryInput } from "../model";
import { MAX_AMOUNT_CENTS } from "../money";
import type { Repositories, UnitOfWork } from "../repositories";
import { STRIPE_FEE_REFUND_LOOKBACK_DAYS } from "./stripe-client";
import { berlinStartOfDay, bookingDateRangeToStripeCreated, subtractDays } from "./stripe-dates";
import { createStripeImportService, STRIPE_BOOKING_DESCRIPTIONS } from "./stripe-import-service";
import { STRIPE_SETTING_KEYS } from "./stripe-settings";
import { createStripeSettingsService } from "./stripe-settings-service";

// A made-up key: no real key anywhere.
const KEY = "rk_test_FAKEFAKEFAKEFAKE0123456789";
const NOW = new Date("2025-07-15T10:00:00.000Z");
const clock = () => NOW;

/** Epoch seconds of an ISO instant. */
const at = (iso: string) => Date.parse(iso) / 1000;

async function setup(options: { key?: boolean; defaults?: boolean } = {}) {
  const db = createInMemoryDatabase({ clock });
  const { repositories } = db;
  const insert = (input: Partial<CategoryInput> & Pick<CategoryInput, "name" | "type">) =>
    repositories.categories.insert({
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
      ...input,
    });
  const sales = await insert({ name: "Umsatzerlöse", type: "income" });
  const refund = await insert({
    name: "Erlösminderung",
    type: "expense",
    reducesIncome: true,
    isSystem: true,
  });
  const stripeClient = createFakeStripeClient();
  const settings = createStripeSettingsService({ unitOfWork: db.unitOfWork, stripeClient });
  if (options.key !== false) await settings.setApiKey(KEY);
  if (options.defaults !== false) {
    await settings.setDefaults({
      defaultVatRate: "19",
      feeCategoryId: sales.id,
      refundCategoryId: refund.id,
    });
  }
  const service = createStripeImportService({ unitOfWork: db.unitOfWork, stripeClient, clock });
  const bookings = async (): Promise<Booking[]> =>
    repositories.bookings.search({ filter: {}, sort: { field: "date", direction: "asc" } });
  return { ...db, service, stripeClient, sales, refund, bookings };
}

const RANGE = { from: "2025-01-01", to: "2025-06-30" };

describe("StripeImportService – mapping", () => {
  it("books a fee as income and a refund as expense with all fields", async () => {
    const { service, stripeClient, sales, refund, bookings } = await setup();
    const fr = stripeFeeRefund({ id: "fr_1", amount: 300, created: at("2025-03-10T09:00:00Z") });
    stripeClient.fees.push(
      stripeFee({
        id: "fee_1",
        amount: 1190,
        account: "acct_A",
        created: at("2025-03-01T22:30:00Z"), // 23:30 Berlin – still 1 March
        refunds: [fr],
      }),
    );
    const result = await service.import(RANGE);
    expect(result).toEqual({
      ok: true,
      range: RANGE,
      keyMode: "test",
      created: 2,
      skipped: 0,
      failed: [],
      fees: { created: 1, skipped: 0, failed: 0 },
      refunds: { created: 1, skipped: 0, failed: 0 },
    });
    const [fee, ref] = await bookings();
    expect(fee).toMatchObject({
      date: "2025-03-01",
      type: "income",
      grossCents: 1190,
      vatRate: "19",
      netCents: 1000,
      vatCents: 190,
      categoryId: sales.id,
      description: STRIPE_BOOKING_DESCRIPTIONS.fee,
      counterparty: "acct_A",
      reference: null,
      note: null,
      source: "stripe",
      externalId: "fee_1",
    });
    expect(ref).toMatchObject({
      date: "2025-03-10",
      type: "expense",
      grossCents: 300,
      vatRate: "19",
      categoryId: refund.id,
      description: STRIPE_BOOKING_DESCRIPTIONS.refund,
      counterparty: "acct_A",
      reference: "fee_1",
      source: "stripe",
      externalId: "fr_1",
    });
  });

  it("books without a VAT rate in small business years, also in a range spanning years", async () => {
    const { service, stripeClient, repositories, bookings } = await setup();
    await repositories.taxYears.upsert({ year: 2024, smallBusiness: true });
    stripeClient.fees.push(
      stripeFee({ id: "fee_2024", amount: 1000, created: at("2024-12-31T22:59:59Z") }),
      // 00:00 Berlin on 1 Jan 2025 – the regularly taxed year.
      stripeFee({ id: "fee_2025", amount: 1190, created: at("2024-12-31T23:00:00Z") }),
    );
    const result = await service.import({ from: "2024-12-01", to: "2025-01-31" });
    expect(result).toMatchObject({ ok: true, created: 2 });
    expect(await bookings()).toMatchObject([
      { externalId: "fee_2024", date: "2024-12-31", vatRate: null, netCents: 1000, vatCents: 0 },
      { externalId: "fee_2025", date: "2025-01-01", vatRate: "19", netCents: 1000, vatCents: 190 },
    ]);
  });
});

describe("StripeImportService – range and refunds", () => {
  it("fetches with the refund lookback and books fees and refunds by their own date", async () => {
    const { service, stripeClient, bookings } = await setup();
    const old = stripeFee({
      id: "fee_old",
      created: at("2024-11-15T12:00:00Z"), // before the range, inside the lookback
      refunds: [
        stripeFeeRefund({ id: "fr_in", created: at("2025-02-01T12:00:00Z") }),
        stripeFeeRefund({ id: "fr_before", created: at("2024-12-01T12:00:00Z") }),
      ],
    });
    const recent = stripeFee({
      id: "fee_in",
      created: at("2025-06-30T21:59:59Z"), // last second of 30 June in Berlin
      refunds: [stripeFeeRefund({ id: "fr_after", created: at("2025-07-01T08:00:00Z") })],
    });
    const after = stripeFee({ id: "fee_after", created: at("2025-06-30T22:00:00Z") });
    stripeClient.fees.push(old, recent, after);

    const result = await service.import(RANGE);
    expect(result).toMatchObject({
      ok: true,
      created: 2,
      fees: { created: 1 },
      refunds: { created: 1 },
    });
    expect((await bookings()).map((b) => b.externalId)).toEqual(["fr_in", "fee_in"]);
    const { createdFrom, createdTo } = bookingDateRangeToStripeCreated(RANGE.from, RANGE.to);
    expect(stripeClient.requests).toEqual([
      {
        apiKey: KEY,
        createdFrom: subtractDays(createdFrom, STRIPE_FEE_REFUND_LOOKBACK_DAYS),
        createdTo,
      },
    ]);
    expect(createdFrom).toBe(berlinStartOfDay(RANGE.from));
  });

  it("validates the range", async () => {
    const { service, stripeClient } = await setup();
    expect(await service.import({ from: "", to: "2025-02-30" })).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "from", code: "required" },
        { field: "to", code: "invalidDate" },
      ],
    });
    expect(await service.import({ from: "2025-03-02", to: "2025-03-01" })).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "to", code: "beforeFrom" }],
    });
    // Today (Berlin) is allowed, tomorrow is not.
    expect(await service.import({ from: "2025-07-01", to: "2025-07-16" })).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "to", code: "inFuture" }],
    });
    expect(stripeClient.requests).toEqual([]);
    expect(await service.import({ from: "2025-07-15", to: "2025-07-15" })).toMatchObject({
      ok: true,
    });
  });
});

describe("StripeImportService – duplicates and failures", () => {
  it("skips existing external IDs and creates deleted ones again", async () => {
    const { service, stripeClient, repositories, bookings } = await setup();
    stripeClient.fees.push(
      stripeFee({
        id: "fee_a",
        created: at("2025-02-01T12:00:00Z"),
        refunds: [stripeFeeRefund({ id: "fr_a", created: at("2025-02-02T12:00:00Z") })],
      }),
      stripeFee({ id: "fee_b", created: at("2025-02-03T12:00:00Z") }),
    );
    expect(await service.import(RANGE)).toMatchObject({ ok: true, created: 3, skipped: 0 });
    expect(await service.import(RANGE)).toMatchObject({
      ok: true,
      created: 0,
      skipped: 3,
      fees: { created: 0, skipped: 2, failed: 0 },
      refunds: { created: 0, skipped: 1, failed: 0 },
    });
    const feeB = (await bookings()).find((b) => b.externalId === "fee_b");
    await repositories.bookings.delete(feeB?.id ?? 0);
    expect(await service.import(RANGE)).toMatchObject({ ok: true, created: 1, skipped: 2 });
    expect(await bookings()).toHaveLength(3);
  });

  it("does not take a manual booking with the same external ID as a duplicate", async () => {
    const { service, stripeClient, repositories, sales } = await setup();
    await repositories.bookings.insert({
      date: "2025-01-05",
      type: "income",
      grossCents: 100,
      vatRate: "0",
      netCents: 100,
      vatCents: 0,
      categoryId: sales.id,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "manual",
      externalId: "fee_m",
    });
    stripeClient.fees.push(stripeFee({ id: "fee_m", created: at("2025-02-01T12:00:00Z") }));
    expect(await service.import(RANGE)).toMatchObject({ ok: true, created: 1, skipped: 0 });
  });

  it("reports other currencies, zero and too large amounts as failed and books the rest", async () => {
    const { service, stripeClient, bookings } = await setup();
    stripeClient.fees.push(
      stripeFee({
        id: "fee_usd",
        currency: "usd",
        amount: 500,
        created: at("2025-02-01T12:00:00Z"),
        refunds: [
          stripeFeeRefund({
            id: "fr_usd",
            currency: "usd",
            amount: 100,
            created: at("2025-02-02T12:00:00Z"),
          }),
        ],
      }),
      stripeFee({
        id: "fee_zero",
        amount: 0,
        created: at("2025-02-03T12:00:00Z"),
        refunds: [
          stripeFeeRefund({ id: "fr_zero", amount: 0, created: at("2025-02-04T12:00:00Z") }),
        ],
      }),
      stripeFee({
        id: "fee_big",
        amount: MAX_AMOUNT_CENTS + 1,
        created: at("2025-02-05T12:00:00Z"),
      }),
      stripeFee({ id: "fee_ok", created: at("2025-02-06T12:00:00Z") }),
    );
    const result = await service.import(RANGE);
    expect(result).toEqual({
      ok: true,
      range: RANGE,
      keyMode: "test",
      created: 1,
      skipped: 0,
      failed: [
        {
          kind: "fee",
          externalId: "fee_usd",
          date: "2025-02-01",
          amount: 500,
          currency: "usd",
          code: "unsupportedCurrency",
        },
        {
          kind: "refund",
          externalId: "fr_usd",
          date: "2025-02-02",
          amount: 100,
          currency: "usd",
          code: "unsupportedCurrency",
        },
        {
          kind: "fee",
          externalId: "fee_zero",
          date: "2025-02-03",
          amount: 0,
          currency: "eur",
          code: "zeroAmount",
        },
        {
          kind: "refund",
          externalId: "fr_zero",
          date: "2025-02-04",
          amount: 0,
          currency: "eur",
          code: "zeroAmount",
        },
        {
          kind: "fee",
          externalId: "fee_big",
          date: "2025-02-05",
          amount: MAX_AMOUNT_CENTS + 1,
          currency: "eur",
          code: "amountTooLarge",
        },
      ],
      fees: { created: 1, skipped: 0, failed: 3 },
      refunds: { created: 0, skipped: 0, failed: 2 },
    });
    expect((await bookings()).map((b) => b.externalId)).toEqual(["fee_ok"]);
  });

  it("reports bookings the booking rules refuse with their field errors", async () => {
    const { service, stripeClient } = await setup();
    stripeClient.fees.push(
      stripeFee({
        id: "fee_long",
        account: `acct_${"x".repeat(200)}`,
        created: at("2025-02-01T12:00:00Z"),
      }),
    );
    expect(await service.import(RANGE)).toMatchObject({
      ok: true,
      created: 0,
      failed: [
        {
          externalId: "fee_long",
          code: "invalidBooking",
          errors: [{ field: "counterparty", code: "tooLong" }],
        },
      ],
      fees: { failed: 1 },
    });
  });

  it("books a fee listed twice once", async () => {
    const { service, stripeClient } = await setup();
    const fee = stripeFee({ id: "fee_dup", created: at("2025-02-01T12:00:00Z") });
    stripeClient.fees.push(fee, fee);
    expect(await service.import(RANGE)).toMatchObject({ ok: true, created: 1, skipped: 0 });
  });
});

describe("StripeImportService – settings, errors, last import", () => {
  it("needs a key and valid defaults", async () => {
    const noKey = await setup({ key: false });
    expect(await noKey.service.import(RANGE)).toEqual({ ok: false, reason: "noApiKey" });
    expect(noKey.stripeClient.requests).toEqual([]);

    const noDefaults = await setup({ defaults: false });
    expect(await noDefaults.service.import(RANGE)).toMatchObject({
      ok: false,
      reason: "invalidDefaults",
      errors: [{ field: "defaultVatRate", code: "required" }, {}, {}],
    });
  });

  it.each([
    { code: "invalidApiKey" },
    { code: "permissionDenied" },
    { code: "rateLimited", retryAfterSeconds: 5 },
    { code: "network" },
    { code: "timeout" },
    { code: "stripeError", status: 500, stripeCode: null, message: null },
    { code: "invalidResponse" },
  ] as const)("returns the client's error $code and writes nothing", async (error) => {
    const { service, stripeClient, repositories, bookings } = await setup();
    stripeClient.fees.push(stripeFee({ created: at("2025-02-01T12:00:00Z") }));
    stripeClient.failWith = error;
    expect(await service.import(RANGE)).toEqual({ ok: false, reason: "stripe", error });
    expect(await bookings()).toEqual([]);
    expect(await repositories.settings.get(STRIPE_SETTING_KEYS.lastImportAt)).toBeUndefined();
  });

  it("stores the last import only on success and keeps the latest period end", async () => {
    const { service, stripeClient } = await setup();
    expect(await service.getStatus()).toEqual({ lastImportAt: null, lastImportTo: null });
    stripeClient.failWith = { code: "network" };
    await service.import(RANGE);
    expect(await service.getStatus()).toEqual({ lastImportAt: null, lastImportTo: null });

    stripeClient.failWith = null;
    stripeClient.fees.push(stripeFee({ currency: "usd", created: at("2025-02-01T12:00:00Z") }));
    // Also with failed items.
    expect(await service.import(RANGE)).toMatchObject({ ok: true, fees: { failed: 1 } });
    expect(await service.getStatus()).toEqual({
      lastImportAt: NOW.toISOString(),
      lastImportTo: "2025-06-30",
    });
    // An older period does not move the end back.
    await service.import({ from: "2025-01-01", to: "2025-01-31" });
    expect((await service.getStatus()).lastImportTo).toBe("2025-06-30");
  });

  it("reads unreadable stored values as no import", async () => {
    const { service, repositories } = await setup();
    await repositories.settings.set(STRIPE_SETTING_KEYS.lastImportAt, "gestern");
    await repositories.settings.set(STRIPE_SETTING_KEYS.lastImportTo, "2025-02-30");
    expect(await service.getStatus()).toEqual({ lastImportAt: null, lastImportTo: null });
  });

  it("uses the settings of the writing transaction", async () => {
    const { service, stripeClient, repositories, sales } = await setup();
    stripeClient.fees.push(stripeFee({ created: at("2025-02-01T12:00:00Z") }));
    // The fee category gets archived while Stripe answers.
    const list = stripeClient.listApplicationFees;
    stripeClient.listApplicationFees = async (request) => {
      const result = await list(request);
      await repositories.categories.setArchived(sales.id, true);
      return result;
    };
    expect(await service.import(RANGE)).toEqual({
      ok: false,
      reason: "invalidDefaults",
      errors: [{ field: "feeCategoryId", code: "categoryArchived" }],
    });
  });

  it("runs all writes in one transaction and rolls back on an unexpected error", async () => {
    const db = await setup();
    db.stripeClient.fees.push(
      stripeFee({ created: at("2025-02-01T12:00:00Z") }),
      stripeFee({ created: at("2025-02-02T12:00:00Z") }),
    );
    let runs = 0;
    // Fails when storing the last import – after the bookings were inserted.
    const failing: UnitOfWork = {
      run: (fn) =>
        db.unitOfWork.run((repos) => {
          runs += 1;
          const settings: Repositories["settings"] = {
            ...repos.settings,
            set: (key, value) =>
              key === STRIPE_SETTING_KEYS.lastImportAt
                ? Promise.reject(new Error("disk full"))
                : repos.settings.set(key, value),
          };
          return fn({ ...repos, settings });
        }),
    };
    const service = createStripeImportService({
      unitOfWork: failing,
      stripeClient: db.stripeClient,
      clock,
    });
    await expect(service.import(RANGE)).rejects.toThrow("disk full");
    expect(runs).toBe(2);
    expect(await db.bookings()).toEqual([]);
  });
});
