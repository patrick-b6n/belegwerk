import { describe, expect, it } from "vitest";

import type { Category } from "@/business/model";

import {
  defaultsFormValues,
  defaultsUnsaved,
  feeCategoryOptions,
  refundCategoryOptions,
  storedDefaultsProblems,
  toStripeDefaultsInput,
} from "./stripe-settings-model";

const category = (overrides: Partial<Category> & Pick<Category, "id" | "name">): Category => ({
  type: "income",
  euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
  reducesIncome: false,
  archived: false,
  isSystem: false,
  ...overrides,
});

const CATEGORIES: Category[] = [
  category({ id: 1, name: "Umsatzerlöse" }),
  category({ id: 2, name: "Alt", archived: true }),
  category({ id: 3, name: "Steuerfrei", euerPosition: "BETRIEBSEINNAHMEN_UST_FREI" }),
  category({ id: 4, name: "Sonstiges", type: "expense", euerPosition: "SONSTIGE_AUSGABEN" }),
  category({ id: 5, name: "Erlösminderung", type: "expense", reducesIncome: true, isSystem: true }),
  category({ id: 6, name: "Gutschrift alt", type: "expense", reducesIncome: true, archived: true }),
  category({ id: 7, name: "USt-Erstattung", euerPosition: "UST_ERSTATTUNG", isSystem: true }),
];

const NONE = { defaultVatRate: null, feeCategoryId: null, refundCategoryId: null };

describe("defaultsFormValues", () => {
  it("starts with the suggestions while nothing is stored", () => {
    expect(defaultsUnsaved(NONE)).toBe(true);
    expect(defaultsFormValues(NONE, CATEGORIES)).toEqual({
      defaultVatRate: "19",
      feeCategoryId: "1",
      refundCategoryId: "5",
    });
    expect(defaultsFormValues(NONE, [])).toEqual({
      defaultVatRate: "19",
      feeCategoryId: "",
      refundCategoryId: "",
    });
  });

  it("uses stored values, even archived categories, but not deleted ones", () => {
    const stored = {
      defaultVatRate: "reverse_charge",
      feeCategoryId: 2,
      refundCategoryId: 99,
    } as const;
    expect(defaultsUnsaved(stored)).toBe(false);
    expect(defaultsFormValues(stored, CATEGORIES)).toEqual({
      defaultVatRate: "reverse_charge",
      feeCategoryId: "2",
      refundCategoryId: "",
    });
  });
});

describe("storedDefaultsProblems", () => {
  it("reports only stored values that became invalid", () => {
    expect(storedDefaultsProblems(NONE, CATEGORIES)).toEqual([]);
    expect(
      storedDefaultsProblems(
        { defaultVatRate: "19", feeCategoryId: 2, refundCategoryId: null },
        CATEGORIES,
      ),
    ).toEqual([{ field: "feeCategoryId", code: "categoryArchived" }]);
    expect(
      storedDefaultsProblems(
        { defaultVatRate: "19", feeCategoryId: 1, refundCategoryId: 4 },
        CATEGORIES,
      ),
    ).toEqual([{ field: "refundCategoryId", code: "categoryNotRevenueReduction" }]);
  });
});

describe("category options", () => {
  it("offers income categories for fees, sorted, without archived ones", () => {
    expect(feeCategoryOptions(CATEGORIES, [null]).map((c) => c.id)).toEqual([3, 1]);
    expect(feeCategoryOptions(CATEGORIES, [2, 3]).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("offers revenue-reducing expense categories for refunds", () => {
    expect(refundCategoryOptions(CATEGORIES, []).map((c) => c.id)).toEqual([5]);
    expect(refundCategoryOptions(CATEGORIES, [null, 6]).map((c) => c.id)).toEqual([5, 6]);
  });
});

describe("toStripeDefaultsInput", () => {
  it("converts selected values and empty selects", () => {
    expect(
      toStripeDefaultsInput({ defaultVatRate: "7", feeCategoryId: "1", refundCategoryId: "5" }),
    ).toEqual({ defaultVatRate: "7", feeCategoryId: 1, refundCategoryId: 5 });
    expect(
      toStripeDefaultsInput({ defaultVatRate: "", feeCategoryId: "", refundCategoryId: "" }),
    ).toEqual({ defaultVatRate: "", feeCategoryId: Number.NaN, refundCategoryId: Number.NaN });
  });
});
