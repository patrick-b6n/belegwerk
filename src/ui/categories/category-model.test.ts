import { describe, expect, it } from "vitest";

import { CATEGORY_NAME_MAX_LENGTH, type CategoryWithUsage } from "@/business/categories";
import {
  EUER_POSITION_DEFINITIONS,
  EUER_POSITIONS,
  validateCategoryPosition,
} from "@/business/euer";

import {
  archivedCount,
  canArchive,
  canDelete,
  categoryFormValues,
  checkName,
  checkPosition,
  errorsByField,
  groupCategories,
  newCategoryFormValues,
  positionAfterChange,
  positionOptions,
  toChanges,
  toCreateInput,
} from "./category-model";

function category(overrides: Partial<CategoryWithUsage> & { id: number }): CategoryWithUsage {
  return {
    name: `Kategorie ${overrides.id}`,
    type: "expense",
    euerPosition: "SONSTIGE_AUSGABEN",
    reducesIncome: false,
    archived: false,
    isSystem: false,
    bookingCount: 0,
    ...overrides,
  };
}

function names(list: readonly CategoryWithUsage[]): string[] {
  return list.map((c) => c.name);
}

describe("groupCategories", () => {
  it("groups by type (income first), splits archived ones off and sorts by name (de)", () => {
    const categories = [
      category({ id: 1, name: "Werbung" }),
      category({ id: 2, name: "Umsatzerlöse", type: "income" }),
      category({ id: 3, name: "Ärger", archived: true }),
      category({ id: 4, name: "Arbeitsmittel" }),
      category({ id: 5, name: "Zinsen", type: "income", archived: true }),
      category({ id: 6, name: "Öl" }),
    ];
    const groups = groupCategories(categories);
    expect(groups.map((group) => group.type)).toEqual(["income", "expense"]);
    expect(names(groups[0]!.active)).toEqual(["Umsatzerlöse"]);
    expect(names(groups[0]!.archived)).toEqual(["Zinsen"]);
    expect(names(groups[1]!.active)).toEqual(["Arbeitsmittel", "Öl", "Werbung"]);
    expect(names(groups[1]!.archived)).toEqual(["Ärger"]);
  });

  it("returns empty groups without categories", () => {
    expect(groupCategories([])).toEqual([
      { type: "income", active: [], archived: [] },
      { type: "expense", active: [], archived: [] },
    ]);
  });

  it("counts archived categories", () => {
    expect(archivedCount([category({ id: 1, archived: true }), category({ id: 2 })])).toBe(1);
  });
});

describe("canDelete / canArchive", () => {
  it("offers delete only for unused non-system categories", () => {
    expect(canDelete(category({ id: 1 }))).toBe(true);
    expect(canDelete(category({ id: 1, archived: true }))).toBe(true);
    expect(canDelete(category({ id: 1, bookingCount: 2 }))).toBe(false);
    expect(canDelete(category({ id: 1, isSystem: true }))).toBe(false);
  });

  it("offers archive only for active non-system categories", () => {
    expect(canArchive(category({ id: 1, bookingCount: 3 }))).toBe(true);
    expect(canArchive(category({ id: 1, archived: true }))).toBe(false);
    expect(canArchive(category({ id: 1, isSystem: true }))).toBe(false);
  });
});

describe("positionOptions", () => {
  it("offers the assignable income positions for income categories", () => {
    expect(positionOptions("income", false)).toEqual([
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      "BETRIEBSEINNAHMEN_UST_FREI",
      "UST_ERSTATTUNG",
    ]);
  });

  it("ignores the flag for income categories", () => {
    expect(positionOptions("income", true)).toEqual(positionOptions("income", false));
  });

  it("offers the assignable expense positions for expense categories", () => {
    const options = positionOptions("expense", false);
    expect(options).toContain("TELEKOMMUNIKATION");
    expect(options).toContain("UST_AN_FA");
    expect(options).not.toContain("VORSTEUER");
    for (const position of options) {
      expect(EUER_POSITION_DEFINITIONS[position]).toMatchObject({
        kind: "expense",
        assignable: true,
      });
    }
  });

  it("offers only the turnover positions for an Erlösminderung", () => {
    expect(positionOptions("expense", true)).toEqual([
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      "BETRIEBSEINNAHMEN_UST_FREI",
    ]);
  });

  it("offers exactly what validateCategoryPosition accepts", () => {
    for (const type of ["income", "expense"] as const) {
      for (const reducesIncome of [false, true]) {
        const flag = reducesIncome && type === "expense";
        const accepted = EUER_POSITIONS.filter(
          (position) =>
            validateCategoryPosition({ type, euerPosition: position, reducesIncome: flag }).ok,
        );
        expect(accepted.length).toBeGreaterThan(0);
        expect(positionOptions(type, reducesIncome)).toEqual(accepted);
      }
    }
  });

  it("does not re-offer an editable category's old position after the flag is set", () => {
    // Editing an expense category on WERBUNG and ticking "mindert Einnahmen":
    // without `keep` (only used for system categories) WERBUNG is gone.
    const options = positionOptions("expense", true);
    expect(options).not.toContain("WERBUNG");
    expect(positionAfterChange("WERBUNG", "expense", true)).toBe("");
  });

  it("keeps a given position in its place even if it is not valid", () => {
    const options = positionOptions("income", false, "UST_VEREINNAHMT");
    expect(options).toEqual([
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      "BETRIEBSEINNAHMEN_UST_FREI",
      "UST_VEREINNAHMT",
      "UST_ERSTATTUNG",
    ]);
    expect(positionOptions("income", false, "UNKNOWN")).toEqual(positionOptions("income", false));
  });
});

describe("positionAfterChange", () => {
  it("keeps a position that is still offered", () => {
    expect(positionAfterChange("BETRIEBSEINNAHMEN_UST_PFLICHTIG", "expense", true)).toBe(
      "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    );
    expect(positionAfterChange("WERBUNG", "expense", false)).toBe("WERBUNG");
  });

  it("clears a position that is no longer offered", () => {
    expect(positionAfterChange("WERBUNG", "expense", true)).toBe("");
    expect(positionAfterChange("WERBUNG", "income", false)).toBe("");
    expect(positionAfterChange("UST_ERSTATTUNG", "expense", true)).toBe("");
    expect(positionAfterChange("", "expense", false)).toBe("");
  });
});

describe("form values", () => {
  it("starts a new category empty", () => {
    expect(newCategoryFormValues("income")).toEqual({
      name: "",
      type: "income",
      euerPosition: "",
      reducesIncome: false,
    });
  });

  it("takes the values of an existing category", () => {
    const existing = category({
      id: 9,
      name: "Erlösminderung",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: true,
    });
    expect(categoryFormValues(existing)).toEqual({
      name: "Erlösminderung",
      type: "expense",
      euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      reducesIncome: true,
    });
  });

  it("sends the flag only for expense categories on create", () => {
    expect(
      toCreateInput({
        name: "A",
        type: "income",
        euerPosition: "UST_ERSTATTUNG",
        reducesIncome: true,
      }),
    ).toEqual({ name: "A", type: "income", euerPosition: "UST_ERSTATTUNG", reducesIncome: false });
    expect(
      toCreateInput({
        name: "B",
        type: "expense",
        euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
        reducesIncome: true,
      }),
    ).toEqual({
      name: "B",
      type: "expense",
      euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
      reducesIncome: true,
    });
  });

  it("sends name, position and flag on update, never the type", () => {
    const existing = category({ id: 1 });
    expect(
      toChanges(
        { name: "Neu", type: "income", euerPosition: "WERBUNG", reducesIncome: false },
        existing,
      ),
    ).toEqual({ name: "Neu", euerPosition: "WERBUNG", reducesIncome: false });
    const income = category({ id: 2, type: "income", euerPosition: "UST_ERSTATTUNG" });
    expect(
      toChanges(
        { name: "X", type: "income", euerPosition: "UST_ERSTATTUNG", reducesIncome: true },
        income,
      ),
    ).toEqual({ name: "X", euerPosition: "UST_ERSTATTUNG", reducesIncome: false });
  });

  it("sends only the name of a system category", () => {
    const system = category({ id: 3, isSystem: true, euerPosition: "UST_AN_FA" });
    expect(
      toChanges(
        { name: "USt", type: "expense", euerPosition: "WERBUNG", reducesIncome: true },
        system,
      ),
    ).toEqual({ name: "USt" });
  });
});

describe("client checks", () => {
  it("requires a name with visible characters", () => {
    expect(checkName("")).toEqual({ field: "name", code: "required" });
    expect(checkName(" ​ ")).toEqual({ field: "name", code: "required" });
    expect(checkName(" Werbung ")).toBeUndefined();
  });

  it("limits the trimmed name length", () => {
    expect(checkName(` ${"a".repeat(CATEGORY_NAME_MAX_LENGTH)} `)).toBeUndefined();
    expect(checkName("a".repeat(CATEGORY_NAME_MAX_LENGTH + 1))).toEqual({
      field: "name",
      code: "tooLong",
    });
  });

  it("requires a position", () => {
    expect(checkPosition("")).toEqual({ field: "euerPosition", code: "required" });
    expect(checkPosition("WERBUNG")).toBeUndefined();
  });
});

describe("errorsByField", () => {
  it("maps the service errors to their fields", () => {
    const map = errorsByField([
      { field: "name", code: "nameDuplicate" },
      { field: "reducesIncome", code: "systemCategoryFixed" },
    ]);
    expect(map.get("name")).toEqual({ field: "name", code: "nameDuplicate" });
    expect(map.get("reducesIncome")).toEqual({
      field: "reducesIncome",
      code: "systemCategoryFixed",
    });
    expect(map.has("euerPosition")).toBe(false);
  });
});
