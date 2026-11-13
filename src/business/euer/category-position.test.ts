import { describe, expect, it } from "vitest";

import { validateCategoryPosition } from "./category-position";

describe("validateCategoryPosition", () => {
  it("accepts positions matching the category type", () => {
    expect(
      validateCategoryPosition({
        type: "income",
        euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        reducesIncome: false,
      }),
    ).toEqual({ ok: true });
    expect(
      validateCategoryPosition({
        type: "income",
        euerPosition: "UST_ERSTATTUNG",
        reducesIncome: false,
      }),
    ).toEqual({ ok: true });
    expect(
      validateCategoryPosition({
        type: "expense",
        euerPosition: "UST_AN_FA",
        reducesIncome: false,
      }),
    ).toEqual({ ok: true });
    expect(
      validateCategoryPosition({ type: "expense", euerPosition: "GWG", reducesIncome: false }),
    ).toEqual({ ok: true });
  });

  it("rejects unknown positions", () => {
    for (const euerPosition of ["", "X", "gwg", "constructor"]) {
      expect(
        validateCategoryPosition({ type: "expense", euerPosition, reducesIncome: false }),
      ).toEqual({ ok: false, error: "unknownPosition" });
    }
  });

  it("rejects positions the calculation fills itself", () => {
    for (const [type, euerPosition] of [
      ["income", "UST_VEREINNAHMT"],
      ["income", "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER"],
      ["expense", "VORSTEUER"],
    ] as const) {
      expect(validateCategoryPosition({ type, euerPosition, reducesIncome: false })).toEqual({
        ok: false,
        error: "positionNotAssignable",
      });
    }
  });

  it("rejects a position of the other side", () => {
    expect(
      validateCategoryPosition({ type: "income", euerPosition: "GWG", reducesIncome: false }),
    ).toEqual({ ok: false, error: "positionKindMismatch" });
    expect(
      validateCategoryPosition({
        type: "expense",
        euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        reducesIncome: false,
      }),
    ).toEqual({ ok: false, error: "positionKindMismatch" });
  });

  it("accepts an Erlösminderung category pointing to the income position it reduces", () => {
    for (const euerPosition of [
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      "BETRIEBSEINNAHMEN_UST_FREI",
      "UST_ERSTATTUNG",
    ]) {
      expect(
        validateCategoryPosition({ type: "expense", euerPosition, reducesIncome: true }),
      ).toEqual({ ok: true });
    }
  });

  it("rejects invalid Erlösminderung categories", () => {
    expect(
      validateCategoryPosition({
        type: "income",
        euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        reducesIncome: true,
      }),
    ).toEqual({ ok: false, error: "reducesIncomeNotExpense" });
    expect(
      validateCategoryPosition({ type: "expense", euerPosition: "WERBUNG", reducesIncome: true }),
    ).toEqual({ ok: false, error: "reducesIncomeNeedsIncomePosition" });
    expect(
      validateCategoryPosition({
        type: "expense",
        euerPosition: "UST_VEREINNAHMT",
        reducesIncome: true,
      }),
    ).toEqual({ ok: false, error: "positionNotAssignable" });
  });
});
