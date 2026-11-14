import { describe, expect, it } from "vitest";

import type { Category } from "../model";
import {
  maskStripeApiKey,
  parseStoredId,
  parseStoredVatRate,
  suggestStripeDefaults,
  validateStripeApiKey,
  validateStripeDefaults,
} from "./stripe-settings";

const BODY = "51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("validateStripeApiKey", () => {
  it("accepts restricted live and test keys, trimmed", () => {
    expect(validateStripeApiKey(`rk_live_${BODY}`)).toEqual({
      ok: true,
      apiKey: `rk_live_${BODY}`,
      mode: "live",
    });
    expect(validateStripeApiKey(` ​ rk_test_${BODY}\n`)).toEqual({
      ok: true,
      apiKey: `rk_test_${BODY}`,
      mode: "test",
    });
  });

  it("rejects empty input and non-strings as required", () => {
    for (const input of ["", "   ", "​", undefined, null, 42]) {
      expect(validateStripeApiKey(input)).toEqual({ ok: false, code: "required" });
    }
  });

  it("rejects secret and publishable keys with their own codes", () => {
    expect(validateStripeApiKey(`sk_live_${BODY}`)).toEqual({
      ok: false,
      code: "secretKeyNotAllowed",
    });
    expect(validateStripeApiKey(`sk_test_${BODY}`)).toEqual({
      ok: false,
      code: "secretKeyNotAllowed",
    });
    expect(validateStripeApiKey(`pk_live_${BODY}`)).toEqual({
      ok: false,
      code: "publishableKeyNotAllowed",
    });
  });

  it("rejects anything else as invalidKey", () => {
    for (const input of [
      BODY,
      "rk_live_",
      "rk_live_short",
      `rk_prod_${BODY}`,
      `RK_LIVE_${BODY}`,
      `rk_live_${BODY} x`,
      `rk_live_${BODY}-x`,
      `rk_live_${BODY}ä`,
      `rk_live_${"a".repeat(248)}`,
    ]) {
      expect(validateStripeApiKey(input)).toEqual({ ok: false, code: "invalidKey" });
    }
    expect(validateStripeApiKey(`rk_live_${"a".repeat(247)}`).ok).toBe(true);
    expect(validateStripeApiKey(`rk_live_${"a".repeat(10)}`).ok).toBe(true);
  });
});

describe("maskStripeApiKey", () => {
  it("shows the prefix and the last four characters only", () => {
    expect(maskStripeApiKey(`rk_live_${BODY}`)).toEqual({ masked: "rk_live_…6789", mode: "live" });
    expect(maskStripeApiKey("rk_test_abcdefghijWXYZ")).toEqual({
      masked: "rk_test_…WXYZ",
      mode: "test",
    });
  });

  it("masks unexpected stored values completely or nearly", () => {
    expect(maskStripeApiKey("geheim")).toEqual({ masked: "…", mode: "live" });
    expect(maskStripeApiKey("sk_live_0123456789")).toEqual({ masked: "…6789", mode: "live" });
    expect(maskStripeApiKey("rk_test_123")).toEqual({ masked: "rk_test_…", mode: "test" });
  });
});

const category = (overrides: Partial<Category> & Pick<Category, "id">): Category => ({
  name: `K${overrides.id}`,
  type: "income",
  euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
  reducesIncome: false,
  archived: false,
  isSystem: false,
  ...overrides,
});

const CATEGORIES: Category[] = [
  category({ id: 1 }),
  category({ id: 2, archived: true }),
  category({ id: 3, type: "expense", euerPosition: "SONSTIGE_AUSGABEN" }),
  category({ id: 4, type: "expense", reducesIncome: true, isSystem: true }),
  category({ id: 5, type: "expense", reducesIncome: true, archived: true }),
  category({ id: 6, euerPosition: "UST_ERSTATTUNG", isSystem: true }),
];

describe("validateStripeDefaults", () => {
  it("accepts an income fee category and a revenue-reducing refund category", () => {
    expect(
      validateStripeDefaults(
        { defaultVatRate: "19", feeCategoryId: 1, refundCategoryId: 4 },
        CATEGORIES,
      ),
    ).toEqual([]);
    for (const defaultVatRate of ["0", "7", "reverse_charge"]) {
      expect(
        validateStripeDefaults(
          { defaultVatRate, feeCategoryId: 1, refundCategoryId: 4 },
          CATEGORIES,
        ),
      ).toEqual([]);
    }
  });

  it("reports missing values for every field", () => {
    expect(validateStripeDefaults({}, CATEGORIES)).toEqual([
      { field: "defaultVatRate", code: "required" },
      { field: "feeCategoryId", code: "required" },
      { field: "refundCategoryId", code: "required" },
    ]);
    expect(
      validateStripeDefaults(
        { defaultVatRate: null, feeCategoryId: Number.NaN, refundCategoryId: "4" },
        CATEGORIES,
      ),
    ).toEqual([
      { field: "defaultVatRate", code: "required" },
      { field: "feeCategoryId", code: "required" },
      { field: "refundCategoryId", code: "required" },
    ]);
  });

  it("rejects unknown VAT rates and unfitting categories", () => {
    expect(
      validateStripeDefaults(
        { defaultVatRate: "16", feeCategoryId: 99, refundCategoryId: 1 },
        CATEGORIES,
      ),
    ).toEqual([
      { field: "defaultVatRate", code: "invalidVatRate" },
      { field: "feeCategoryId", code: "categoryNotFound" },
      { field: "refundCategoryId", code: "categoryTypeMismatch" },
    ]);
    expect(
      validateStripeDefaults(
        { defaultVatRate: "19", feeCategoryId: 3, refundCategoryId: 3 },
        CATEGORIES,
      ),
    ).toEqual([
      { field: "feeCategoryId", code: "categoryTypeMismatch" },
      { field: "refundCategoryId", code: "categoryNotRevenueReduction" },
    ]);
    expect(
      validateStripeDefaults(
        { defaultVatRate: "19", feeCategoryId: 2, refundCategoryId: 5 },
        CATEGORIES,
      ),
    ).toEqual([
      { field: "feeCategoryId", code: "categoryArchived" },
      { field: "refundCategoryId", code: "categoryArchived" },
    ]);
  });
});

describe("validateStripeDefaults – tax office", () => {
  it("rejects the tax office refund category for fees", () => {
    expect(
      validateStripeDefaults(
        { defaultVatRate: "0", feeCategoryId: 6, refundCategoryId: 4 },
        CATEGORIES,
      ),
    ).toEqual([{ field: "feeCategoryId", code: "categoryTaxOffice" }]);
  });
});

describe("suggestStripeDefaults", () => {
  it("finds the categories by position and flag", () => {
    expect(suggestStripeDefaults(CATEGORIES)).toEqual({
      defaultVatRate: "19",
      feeCategoryId: 1,
      refundCategoryId: 4,
    });
  });

  it("prefers the system refund category, skips archived ones and falls back", () => {
    const categories = [
      category({ id: 9, type: "expense", reducesIncome: true, euerPosition: "X" }),
      category({ id: 8, type: "expense", reducesIncome: true }),
      category({ id: 7, type: "expense", reducesIncome: true, isSystem: true, archived: true }),
      category({ id: 6, archived: true }),
      category({ id: 10, euerPosition: "BETRIEBSEINNAHMEN_UST_FREI" }),
    ];
    expect(suggestStripeDefaults(categories)).toEqual({
      defaultVatRate: "19",
      feeCategoryId: null,
      refundCategoryId: 8,
    });
    expect(suggestStripeDefaults([categories[0] as Category])).toMatchObject({
      refundCategoryId: 9,
    });
    expect(suggestStripeDefaults([])).toEqual({
      defaultVatRate: "19",
      feeCategoryId: null,
      refundCategoryId: null,
    });
  });
});

describe("stored values", () => {
  it("parses VAT rates and ids, unreadable values are null", () => {
    expect(parseStoredVatRate("7")).toBe("7");
    expect(parseStoredVatRate(undefined)).toBeNull();
    expect(parseStoredVatRate("16")).toBeNull();
    expect(parseStoredId("12")).toBe(12);
    for (const value of [undefined, "", "0", "-1", "1.5", "1e3", " 1", "9".repeat(16)]) {
      expect(parseStoredId(value)).toBeNull();
    }
  });
});
