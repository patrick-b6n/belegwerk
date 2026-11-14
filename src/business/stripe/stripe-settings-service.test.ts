import { describe, expect, it, vi } from "vitest";

import { createFakeStripeClient } from "../__tests__/fake-stripe-client";
import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import type { CategoryInput } from "../model";
import type { UnitOfWork } from "../repositories";
import { STRIPE_SETTING_KEYS } from "./stripe-settings";
import { createStripeSettingsService, loadStripeImportSettings } from "./stripe-settings-service";

const KEY = "rk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const TEST_KEY = "rk_test_51ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210";

async function setup() {
  const { repositories, unitOfWork } = createInMemoryDatabase();
  const insert = (input: Partial<CategoryInput> & Pick<CategoryInput, "name" | "type">) =>
    repositories.categories.insert({
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: false,
      isSystem: false,
      ...input,
    });
  const sales = await insert({ name: "Umsatzerlöse", type: "income" });
  const other = await insert({
    name: "Sonstiges",
    type: "expense",
    euerPosition: "SONSTIGE_AUSGABEN",
  });
  const refund = await insert({
    name: "Erlösminderung",
    type: "expense",
    reducesIncome: true,
    isSystem: true,
  });
  const stripeClient = createFakeStripeClient();
  const service = createStripeSettingsService({ unitOfWork, stripeClient });
  return { repositories, unitOfWork, service, stripeClient, sales, other, refund };
}

const emptyDefaults = { defaultVatRate: null, feeCategoryId: null, refundCategoryId: null };

describe("StripeSettingsService – API key", () => {
  it("starts without key and defaults", async () => {
    const { service } = await setup();
    expect(await service.get()).toEqual({ apiKey: null, defaults: emptyDefaults });
  });

  it("stores a restricted key trimmed and returns it masked only", async () => {
    const { service, repositories } = await setup();
    expect(await service.setApiKey(`  ${KEY}\n`)).toEqual({
      ok: true,
      apiKey: { masked: "rk_live_…6789", mode: "live" },
    });
    expect(await repositories.settings.get(STRIPE_SETTING_KEYS.apiKey)).toBe(KEY);
    const settings = await service.get();
    expect(settings).toEqual({
      apiKey: { masked: "rk_live_…6789", mode: "live" },
      defaults: emptyDefaults,
    });
    expect(JSON.stringify(settings)).not.toContain(KEY.slice(8, -4));

    // Replacing the key.
    expect(await service.setApiKey(TEST_KEY)).toMatchObject({ ok: true, apiKey: { mode: "test" } });
    expect(await repositories.settings.get(STRIPE_SETTING_KEYS.apiKey)).toBe(TEST_KEY);
  });

  it("rejects invalid keys, secret keys included, and keeps the stored one", async () => {
    const { service, repositories } = await setup();
    await service.setApiKey(KEY);
    for (const [input, code] of [
      ["", "required"],
      ["sk_live_51AbCdEfGhIjKlMnOp", "secretKeyNotAllowed"],
      ["pk_test_51AbCdEfGhIjKlMnOp", "publishableKeyNotAllowed"],
      ["rk_live_kurz", "invalidKey"],
    ] as const) {
      expect(await service.setApiKey(input)).toEqual({
        ok: false,
        reason: "invalid",
        errors: [{ field: "apiKey", code }],
      });
    }
    expect(await repositories.settings.get(STRIPE_SETTING_KEYS.apiKey)).toBe(KEY);
  });

  it("deletes the key and keeps the defaults", async () => {
    const { service, sales, refund } = await setup();
    await service.setApiKey(KEY);
    await service.setDefaults({
      defaultVatRate: "19",
      feeCategoryId: sales.id,
      refundCategoryId: refund.id,
    });
    expect(await service.deleteApiKey()).toEqual({ ok: true, deleted: true });
    expect(await service.deleteApiKey()).toEqual({ ok: true, deleted: false });
    expect(await service.get()).toEqual({
      apiKey: null,
      defaults: { defaultVatRate: "19", feeCategoryId: sales.id, refundCategoryId: refund.id },
    });
  });

  it("does not leak the key when storing fails", async () => {
    const failing: UnitOfWork = {
      run: () => Promise.reject(new Error(`params: ${KEY}`)),
    };
    const service = createStripeSettingsService({
      unitOfWork: failing,
      stripeClient: createFakeStripeClient(),
    });
    const error: unknown = await service.setApiKey(KEY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(KEY);
    expect((error as Error).cause).toBeUndefined();
  });
});

describe("StripeSettingsService – defaults", () => {
  it("stores valid defaults", async () => {
    const { service, repositories, sales, refund } = await setup();
    const defaults = {
      defaultVatRate: "reverse_charge",
      feeCategoryId: sales.id,
      refundCategoryId: refund.id,
    } as const;
    expect(await service.setDefaults(defaults)).toEqual({ ok: true, defaults });
    expect(await service.get()).toEqual({ apiKey: null, defaults });
    expect(await repositories.settings.get(STRIPE_SETTING_KEYS.feeCategoryId)).toBe(
      String(sales.id),
    );
  });

  it("returns all field errors and writes nothing", async () => {
    const { service, other, sales } = await setup();
    expect(
      await service.setDefaults({
        defaultVatRate: "16" as "19",
        feeCategoryId: other.id,
        refundCategoryId: sales.id,
      }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "defaultVatRate", code: "invalidVatRate" },
        { field: "feeCategoryId", code: "categoryTypeMismatch" },
        { field: "refundCategoryId", code: "categoryTypeMismatch" },
      ],
    });
    expect(
      await service.setDefaults({
        defaultVatRate: "19",
        feeCategoryId: Number.NaN,
        refundCategoryId: other.id,
      }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "feeCategoryId", code: "required" },
        { field: "refundCategoryId", code: "categoryNotRevenueReduction" },
      ],
    });
    expect((await service.get()).defaults).toEqual(emptyDefaults);
  });

  it("rejects archived categories", async () => {
    const { service, repositories, sales, refund } = await setup();
    await repositories.categories.setArchived(sales.id, true);
    expect(
      await service.setDefaults({
        defaultVatRate: "19",
        feeCategoryId: sales.id,
        refundCategoryId: refund.id,
      }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "feeCategoryId", code: "categoryArchived" }],
    });
  });

  it("reads unreadable stored values as not set", async () => {
    const { service, repositories } = await setup();
    await repositories.settings.set(STRIPE_SETTING_KEYS.defaultVatRate, "16");
    await repositories.settings.set(STRIPE_SETTING_KEYS.feeCategoryId, "abc");
    expect((await service.get()).defaults).toEqual(emptyDefaults);
  });
});

describe("loadStripeImportSettings", () => {
  it("returns the key and the validated defaults within the caller's unit of work", async () => {
    const { service, unitOfWork, sales, refund } = await setup();
    expect(await unitOfWork.run(loadStripeImportSettings)).toEqual({
      ok: false,
      reason: "noApiKey",
    });
    await service.setApiKey(KEY);
    expect(await unitOfWork.run(loadStripeImportSettings)).toEqual({
      ok: false,
      reason: "invalidDefaults",
      errors: [
        { field: "defaultVatRate", code: "required" },
        { field: "feeCategoryId", code: "required" },
        { field: "refundCategoryId", code: "required" },
      ],
    });
    await service.setDefaults({
      defaultVatRate: "19",
      feeCategoryId: sales.id,
      refundCategoryId: refund.id,
    });
    expect(await unitOfWork.run(loadStripeImportSettings)).toEqual({
      ok: true,
      apiKey: KEY,
      defaultVatRate: "19",
      feeCategory: sales,
      refundCategory: refund,
    });
  });

  it("revalidates stored defaults and treats an invalid stored key as missing", async () => {
    const { service, repositories, unitOfWork, sales, refund } = await setup();
    await service.setApiKey(KEY);
    await service.setDefaults({
      defaultVatRate: "19",
      feeCategoryId: sales.id,
      refundCategoryId: refund.id,
    });
    await repositories.categories.setArchived(sales.id, true);
    expect(await unitOfWork.run(loadStripeImportSettings)).toEqual({
      ok: false,
      reason: "invalidDefaults",
      errors: [{ field: "feeCategoryId", code: "categoryArchived" }],
    });
    await repositories.settings.set(STRIPE_SETTING_KEYS.apiKey, "sk_live_0123456789abc");
    expect(await unitOfWork.run(loadStripeImportSettings)).toEqual({
      ok: false,
      reason: "noApiKey",
    });
  });
});

describe("StripeSettingsService – testConnection", () => {
  it("needs a stored valid key", async () => {
    const { service, repositories } = await setup();
    expect(await service.testConnection()).toEqual({ ok: false, reason: "noApiKey" });
    await repositories.settings.set(STRIPE_SETTING_KEYS.apiKey, "sk_live_0123456789abc");
    expect(await service.testConnection()).toEqual({ ok: false, reason: "noApiKey" });
  });

  it("verifies the stored key with the client", async () => {
    const { service, stripeClient } = await setup();
    const verify = vi.spyOn(stripeClient, "verifyAccess");
    await service.setApiKey(KEY);
    expect(await service.testConnection()).toEqual({ ok: true, livemode: null });
    expect(verify).toHaveBeenCalledWith({ apiKey: KEY });
  });

  it("returns the client's error", async () => {
    const { service, stripeClient } = await setup();
    await service.setApiKey(KEY);
    stripeClient.failWith = { code: "permissionDenied" };
    expect(await service.testConnection()).toEqual({
      ok: false,
      reason: "stripe",
      error: { code: "permissionDenied" },
    });
  });
});
