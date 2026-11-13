import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import type { Category, CategoryInput } from "../model";
import type { ConstraintKind, Repositories, UnitOfWork } from "../repositories";
import { ConstraintViolationError } from "../repositories";
import {
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryFieldError,
  type CategoryFormInput,
  createCategoryService,
} from "./category-service";

const formInput = (overrides: Partial<CategoryFormInput> = {}): CategoryFormInput => ({
  name: "Software",
  type: "expense",
  euerPosition: "EDV_KOSTEN",
  reducesIncome: false,
  ...overrides,
});

async function setup() {
  const { repositories, unitOfWork } = createInMemoryDatabase();
  const insert = (fields: Partial<CategoryInput> & Pick<CategoryInput, "name" | "type">) =>
    repositories.categories.insert({
      euerPosition:
        fields.type === "income" ? "BETRIEBSEINNAHMEN_UST_PFLICHTIG" : "TELEKOMMUNIKATION",
      reducesIncome: false,
      isSystem: false,
      ...fields,
    });
  const income = await insert({ name: "Umsatzerlöse", type: "income" });
  const expense = await insert({ name: "Büro", type: "expense", euerPosition: "ARBEITSMITTEL" });
  const archived = await insert({ name: "Alt", type: "expense" });
  await repositories.categories.setArchived(archived.id, true);
  const vatPayment = await insert({
    name: "USt-Vorauszahlung",
    type: "expense",
    euerPosition: "UST_AN_FA",
    isSystem: true,
  });
  const reduction = await insert({
    name: "Erlösminderung / Rückerstattung",
    type: "expense",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: true,
    isSystem: true,
  });
  const service = createCategoryService({ unitOfWork });
  const addBooking = (category: Category) =>
    repositories.bookings.insert({
      date: "2025-03-01",
      type: category.type,
      grossCents: 100,
      vatRate: null,
      netCents: 100,
      vatCents: 0,
      categoryId: category.id,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "manual",
      externalId: null,
    });
  return {
    repositories,
    service,
    input: formInput,
    insert,
    addBooking,
    income,
    expense,
    archived: { ...archived, archived: true },
    vatPayment,
    reduction,
  };
}

function errorsOf(result: { ok: boolean }): readonly CategoryFieldError[] {
  if (result.ok || !("errors" in result)) {
    throw new Error(`Expected validation errors, got ${JSON.stringify(result)}`);
  }
  return result.errors as readonly CategoryFieldError[];
}

const BAD_IDS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53];

describe("CategoryService.list and get", () => {
  it("lists all categories incl. archived ones by id, with booking counts", async () => {
    const { service, addBooking, income, expense, archived } = await setup();
    await addBooking(income);
    await addBooking(income);
    await addBooking(archived);
    const list = await service.list();
    expect(list.map((c) => [c.name, c.archived, c.bookingCount])).toEqual([
      ["Umsatzerlöse", false, 2],
      ["Büro", false, 0],
      ["Alt", true, 1],
      ["USt-Vorauszahlung", false, 0],
      ["Erlösminderung / Rückerstattung", false, 0],
    ]);
    expect(list[1]).toEqual({ ...expense, bookingCount: 0 });
  });

  it("loads a category", async () => {
    const { service, expense } = await setup();
    expect(await service.get(expense.id)).toEqual({ ok: true, category: expense });
  });

  it.each([...BAD_IDS, 999])("returns notFound for id %s", async (id) => {
    const { service } = await setup();
    expect(await service.get(id)).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("CategoryService.create", () => {
  it("creates a normal, unarchived category with trimmed name", async () => {
    const { service, input, repositories } = await setup();
    const result = await service.create(input({ name: "\u200B  Software \uFEFF" }));
    expect(result).toEqual({
      ok: true,
      category: {
        id: expect.any(Number),
        name: "Software",
        type: "expense",
        euerPosition: "EDV_KOSTEN",
        reducesIncome: false,
        archived: false,
        isSystem: false,
      },
    });
    if (!result.ok) return;
    expect(await repositories.categories.findById(result.category.id)).toEqual(result.category);
  });

  it("creates an Erlösminderung category", async () => {
    const { service, input } = await setup();
    const result = await service.create(
      input({
        name: "Gutschriften",
        euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
        reducesIncome: true,
      }),
    );
    expect(result).toMatchObject({ ok: true, category: { reducesIncome: true } });
  });

  it.each([
    ["", "required"],
    [" \u200B\u200C\u200D\uFEFF\t\n", "required"],
    ["\u2060\u00AD\u180E\u00A0", "required"],
    ["x".repeat(CATEGORY_NAME_MAX_LENGTH + 1), "tooLong"],
  ] as const)("rejects the name %j with %s", async (name, code) => {
    const { service, input } = await setup();
    expect(errorsOf(await service.create(input({ name })))).toEqual([{ field: "name", code }]);
  });

  it("accepts a name of maximum length (after trimming)", async () => {
    const { service, input } = await setup();
    const name = "x".repeat(CATEGORY_NAME_MAX_LENGTH);
    expect(await service.create(input({ name: ` ${name} ` }))).toMatchObject({
      ok: true,
      category: { name },
    });
  });

  it.each([
    ["the same name", "Büro"],
    ["upper case incl. umlaut", "BÜRO"],
    ["lower case and padding", "  büro "],
    ["a combining umlaut", "Büro"],
    ["an archived category's name", "ALT"],
  ])("rejects %s as duplicate within the type", async (_case, name) => {
    const { service, input } = await setup();
    expect(errorsOf(await service.create(input({ name })))).toEqual([
      { field: "name", code: "nameDuplicate" },
    ]);
  });

  it("stores names NFC-normalized", async () => {
    const { service, input } = await setup();
    const result = await service.create(input({ name: "Gebühren" }));
    expect(result).toMatchObject({ ok: true, category: { name: "Gebühren" } });
  });

  it("allows the same name for the other type", async () => {
    const { service, input } = await setup();
    const result = await service.create(
      input({ name: "büro", type: "income", euerPosition: "BETRIEBSEINNAHMEN_UST_FREI" }),
    );
    expect(result.ok).toBe(true);
  });

  it("does not treat distinct letters as equal (ß vs. ss)", async () => {
    const { service, input } = await setup();
    expect((await service.create(input({ name: "Maße" }))).ok).toBe(true);
    expect((await service.create(input({ name: "Masse" }))).ok).toBe(true);
    expect(errorsOf(await service.create(input({ name: "MAßE" })))).toEqual([
      { field: "name", code: "nameDuplicate" },
    ]);
  });

  it.each([
    [{ euerPosition: "" }, [{ field: "euerPosition", code: "required" }]],
    [{ euerPosition: "FOO" }, [{ field: "euerPosition", code: "unknownPosition" }]],
    [{ euerPosition: "VORSTEUER" }, [{ field: "euerPosition", code: "positionNotAssignable" }]],
    [
      { euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG" },
      [{ field: "euerPosition", code: "positionKindMismatch" }],
    ],
    [
      { type: "income", euerPosition: "WERBUNG" },
      [{ field: "euerPosition", code: "positionKindMismatch" }],
    ],
    [
      { reducesIncome: true, euerPosition: "WERBUNG" },
      [{ field: "euerPosition", code: "reducesIncomeNeedsIncomePosition" }],
    ],
    [
      { reducesIncome: true, euerPosition: "UST_ERSTATTUNG" },
      [{ field: "euerPosition", code: "reducesIncomeNeedsTurnoverPosition" }],
    ],
    [
      { type: "income", reducesIncome: true, euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG" },
      [{ field: "reducesIncome", code: "reducesIncomeNotExpense" }],
    ],
    [
      { type: "income", reducesIncome: true, euerPosition: "WERBUNG" },
      [
        { field: "euerPosition", code: "positionKindMismatch" },
        { field: "reducesIncome", code: "reducesIncomeNotExpense" },
      ],
    ],
    [{ type: "transfer", euerPosition: "WERBUNG" }, [{ field: "type", code: "invalidType" }]],
    [
      { type: "transfer", euerPosition: "VORSTEUER", reducesIncome: true },
      [
        { field: "type", code: "invalidType" },
        { field: "euerPosition", code: "positionNotAssignable" },
      ],
    ],
  ] as const)("validates position and flag %j", async (overrides, errors) => {
    const { service, input, repositories } = await setup();
    const before = await repositories.categories.list();
    const result = await service.create(input(overrides as unknown as Partial<CategoryFormInput>));
    expect(errorsOf(result)).toEqual(errors);
    expect(await repositories.categories.list()).toEqual(before);
  });

  it.each([undefined, null, "true", 1])(
    "rejects the non-boolean reducesIncome %j as invalidValue",
    async (reducesIncome) => {
      const { service, input, repositories } = await setup();
      const before = await repositories.categories.list();
      const result = await service.create(
        input({ reducesIncome: reducesIncome as unknown as boolean, euerPosition: "VORSTEUER" }),
      );
      expect(errorsOf(result)).toEqual([
        { field: "euerPosition", code: "positionNotAssignable" },
        { field: "reducesIncome", code: "invalidValue" },
      ]);
      expect(await repositories.categories.list()).toEqual(before);
    },
  );

  it("reports all field errors at once", async () => {
    const { service, input } = await setup();
    const result = await service.create(
      input({ name: "büro", euerPosition: "FOO", type: "income", reducesIncome: true }),
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "euerPosition", code: "unknownPosition" },
        { field: "reducesIncome", code: "reducesIncomeNotExpense" },
      ],
    });
    // "büro" is free among income categories; among expenses it is not.
    expect(errorsOf(await service.create(input({ name: "büro", euerPosition: "FOO" })))).toEqual([
      { field: "name", code: "nameDuplicate" },
      { field: "euerPosition", code: "unknownPosition" },
    ]);
  });
});

describe("CategoryService.update", () => {
  it("renames a category", async () => {
    const { service, expense } = await setup();
    expect(await service.update(expense.id, { name: " Bürobedarf " })).toEqual({
      ok: true,
      category: { ...expense, name: "Bürobedarf" },
    });
  });

  it("allows changing only the case of its own name", async () => {
    const { service, expense } = await setup();
    expect(await service.update(expense.id, { name: "BÜRO" })).toMatchObject({
      ok: true,
      category: { name: "BÜRO" },
    });
  });

  it("rejects the name of another category of the same type, also an archived one", async () => {
    const { service, expense } = await setup();
    for (const name of ["usT-vorauszahlung", "alt"]) {
      expect(errorsOf(await service.update(expense.id, { name }))).toEqual([
        { field: "name", code: "nameDuplicate" },
      ]);
    }
    expect((await service.update(expense.id, { name: "umsatzerlöse" })).ok).toBe(true);
  });

  it("changes the EÜR position without touching bookings (applies retroactively)", async () => {
    const { service, expense, addBooking, repositories } = await setup();
    const booking = await addBooking(expense);
    expect(await service.update(expense.id, { euerPosition: "WERBUNG" })).toEqual({
      ok: true,
      category: { ...expense, euerPosition: "WERBUNG" },
    });
    expect(await repositories.bookings.findById(booking.id)).toEqual(booking);
  });

  it("turns an expense category into an Erlösminderung and back", async () => {
    const { service, expense } = await setup();
    expect(
      await service.update(expense.id, {
        reducesIncome: true,
        euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
      }),
    ).toMatchObject({ ok: true, category: { reducesIncome: true } });
    expect(errorsOf(await service.update(expense.id, { reducesIncome: false }))).toEqual([
      { field: "euerPosition", code: "positionKindMismatch" },
    ]);
    expect(
      await service.update(expense.id, { reducesIncome: false, euerPosition: "ARBEITSMITTEL" }),
    ).toMatchObject({
      ok: true,
      category: { reducesIncome: false, euerPosition: "ARBEITSMITTEL" },
    });
  });

  it("rejects a non-boolean reducesIncome on update, also for system categories", async () => {
    const { service, expense, vatPayment } = await setup();
    for (const { id } of [expense, vatPayment]) {
      expect(
        errorsOf(
          await service.update(id, {
            name: "",
            reducesIncome: "yes" as unknown as boolean,
          }),
        ),
      ).toEqual([
        { field: "name", code: "required" },
        { field: "reducesIncome", code: "invalidValue" },
      ]);
    }
  });

  it("validates the position against the category's type", async () => {
    const { service, income } = await setup();
    expect(errorsOf(await service.update(income.id, { euerPosition: "WERBUNG" }))).toEqual([
      { field: "euerPosition", code: "positionKindMismatch" },
    ]);
    expect(errorsOf(await service.update(income.id, { reducesIncome: true }))).toEqual([
      { field: "reducesIncome", code: "reducesIncomeNotExpense" },
    ]);
  });

  it("does not validate an unchanged position on rename", async () => {
    const { service, insert } = await setup();
    // E.g. a position that became non-assignable in a later version.
    const legacy = await insert({ name: "Legacy", type: "expense", euerPosition: "VORSTEUER" });
    expect(
      await service.update(legacy.id, { name: "Neu", euerPosition: "VORSTEUER" }),
    ).toMatchObject({
      ok: true,
      category: { name: "Neu" },
    });
  });

  it("edits archived categories", async () => {
    const { service, archived } = await setup();
    expect(await service.update(archived.id, { name: "Alt (bis 2024)" })).toMatchObject({
      ok: true,
      category: { name: "Alt (bis 2024)", archived: true },
    });
  });

  it("renames a system category but keeps its position and flag fixed", async () => {
    const { service, vatPayment, reduction } = await setup();
    expect(
      await service.update(vatPayment.id, {
        name: "Umsatzsteuer ans Finanzamt",
        euerPosition: "UST_AN_FA",
        reducesIncome: false,
      }),
    ).toEqual({ ok: true, category: { ...vatPayment, name: "Umsatzsteuer ans Finanzamt" } });
    expect(
      errorsOf(await service.update(vatPayment.id, { euerPosition: "SONSTIGE_AUSGABEN" })),
    ).toEqual([{ field: "euerPosition", code: "systemCategoryFixed" }]);
    expect(
      errorsOf(
        await service.update(reduction.id, {
          name: "",
          euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
          reducesIncome: false,
        }),
      ),
    ).toEqual([
      { field: "name", code: "required" },
      { field: "euerPosition", code: "systemCategoryFixed" },
      { field: "reducesIncome", code: "systemCategoryFixed" },
    ]);
  });

  it.each([...BAD_IDS, 999])("returns notFound for id %s", async (id) => {
    const { service } = await setup();
    expect(await service.update(id, { name: "x" })).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("CategoryService.archive and reactivate", () => {
  it("archives and reactivates (idempotently)", async () => {
    const { service, expense } = await setup();
    const archived = { ok: true, category: { ...expense, archived: true } };
    expect(await service.archive(expense.id)).toEqual(archived);
    expect(await service.archive(expense.id)).toEqual(archived);
    const active = { ok: true, category: expense };
    expect(await service.reactivate(expense.id)).toEqual(active);
    expect(await service.reactivate(expense.id)).toEqual(active);
  });

  it("archives a category in use; its bookings stay", async () => {
    const { service, expense, addBooking, repositories } = await setup();
    const booking = await addBooking(expense);
    expect((await service.archive(expense.id)).ok).toBe(true);
    expect(await repositories.bookings.findById(booking.id)).toEqual(booking);
  });

  it("does not archive system categories", async () => {
    const { service, vatPayment, reduction, repositories } = await setup();
    for (const { id } of [vatPayment, reduction]) {
      expect(await service.archive(id)).toEqual({ ok: false, reason: "systemCategory" });
      expect((await repositories.categories.findById(id))?.archived).toBe(false);
      expect(await service.reactivate(id)).toMatchObject({ ok: true });
    }
  });

  it("reactivates an archived system category (e.g. archived before #15)", async () => {
    const { service, vatPayment, repositories } = await setup();
    await repositories.categories.setArchived(vatPayment.id, true);
    expect(await service.reactivate(vatPayment.id)).toEqual({ ok: true, category: vatPayment });
  });

  it.each([...BAD_IDS, 999])("returns notFound for id %s", async (id) => {
    const { service } = await setup();
    expect(await service.archive(id)).toEqual({ ok: false, reason: "notFound" });
    expect(await service.reactivate(id)).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("CategoryService.delete", () => {
  it("deletes an unused category, also an archived one", async () => {
    const { service, expense, archived, repositories } = await setup();
    expect(await service.delete(expense.id)).toEqual({ ok: true });
    expect(await service.delete(archived.id)).toEqual({ ok: true });
    expect(await repositories.categories.findById(expense.id)).toBeUndefined();
    expect(await service.get(expense.id)).toEqual({ ok: false, reason: "notFound" });
  });

  it("refuses a category in use with the number of bookings", async () => {
    const { service, expense, addBooking, repositories } = await setup();
    await addBooking(expense);
    await addBooking(expense);
    expect(await service.delete(expense.id)).toEqual({
      ok: false,
      reason: "inUse",
      bookingCount: 2,
    });
    expect(await repositories.categories.findById(expense.id)).toEqual(expense);
  });

  it("does not delete system categories", async () => {
    const { service, vatPayment, reduction } = await setup();
    for (const { id } of [vatPayment, reduction]) {
      expect(await service.delete(id)).toEqual({ ok: false, reason: "systemCategory" });
    }
  });

  it.each([...BAD_IDS, 999])("returns notFound for id %s", async (id) => {
    const { service } = await setup();
    expect(await service.delete(id)).toEqual({ ok: false, reason: "notFound" });
  });
});

/** Unit of work whose category writes fail like a concurrent write would make them fail. */
function failingUnitOfWork(inner: UnitOfWork, error: Error): UnitOfWork {
  return {
    run: (fn) =>
      inner.run((repos: Repositories) =>
        fn({
          ...repos,
          categories: {
            ...repos.categories,
            insert: async () => Promise.reject(error),
            update: async () => Promise.reject(error),
            delete: async () => Promise.reject(error),
          },
        }),
      ),
  };
}

describe("CategoryService and constraint errors", () => {
  it("maps a unique violation on create and update to nameDuplicate", async () => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const service = createCategoryService({
      unitOfWork: failingUnitOfWork(unitOfWork, new ConstraintViolationError("unique", "boom")),
    });
    const category = await repositories.categories.insert({
      name: "Büro",
      type: "expense",
      euerPosition: "ARBEITSMITTEL",
      reducesIncome: false,
      isSystem: false,
    });
    const duplicate = {
      ok: false,
      reason: "invalid",
      errors: [{ field: "name", code: "nameDuplicate" }],
    };
    expect(
      await service.create({
        name: "Neu",
        type: "expense",
        euerPosition: "WERBUNG",
        reducesIncome: false,
      }),
    ).toEqual(duplicate);
    expect(await service.update(category.id, { name: "Neu" })).toEqual(duplicate);
  });

  it("maps a foreign key violation on delete to inUse with at least one booking", async () => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Büro",
      type: "expense",
      euerPosition: "ARBEITSMITTEL",
      reducesIncome: false,
      isSystem: false,
    });
    const service = createCategoryService({
      unitOfWork: failingUnitOfWork(
        unitOfWork,
        new ConstraintViolationError("foreign_key", "boom"),
      ),
    });
    // The fake's count is 0 (the failing delete is simulated), the violation proves one.
    expect(await service.delete(category.id)).toEqual({
      ok: false,
      reason: "inUse",
      bookingCount: 1,
    });
  });

  it.each([
    ["a plain error", new Error("disk I/O error")],
    ["a foreign key error on create", new ConstraintViolationError("foreign_key", "boom")],
    [
      "a constraint error of another kind",
      new ConstraintViolationError("check" as ConstraintKind, "boom"),
    ],
  ])("rethrows %s", async (_name, error) => {
    const { unitOfWork } = createInMemoryDatabase();
    const service = createCategoryService({ unitOfWork: failingUnitOfWork(unitOfWork, error) });
    await expect(
      service.create({
        name: "Neu",
        type: "expense",
        euerPosition: "WERBUNG",
        reducesIncome: false,
      }),
    ).rejects.toBe(error);
  });

  it("rethrows a non-constraint error on delete", async () => {
    const { unitOfWork, repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "Büro",
      type: "expense",
      euerPosition: "ARBEITSMITTEL",
      reducesIncome: false,
      isSystem: false,
    });
    const error = new ConstraintViolationError("unique", "boom");
    const service = createCategoryService({ unitOfWork: failingUnitOfWork(unitOfWork, error) });
    await expect(service.delete(category.id)).rejects.toBe(error);
  });
});
