import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import type { BookingInput, BookingType, VatRate } from "../model";
import { splitGross } from "../money";
import type { UnitOfWork } from "../repositories";
import { createEuerService } from "./euer-service";

async function setup() {
  const { repositories, unitOfWork } = createInMemoryDatabase();
  const insertCategory = (
    name: string,
    type: BookingType,
    euerPosition: string,
    reducesIncome = false,
  ) => repositories.categories.insert({ name, type, euerPosition, reducesIncome, isSystem: false });
  const sales = await insertCategory("Umsatz", "income", "BETRIEBSEINNAHMEN_UST_PFLICHTIG");
  const software = await insertCategory("Software", "expense", "EDV_KOSTEN");
  const refund = await insertCategory(
    "Erstattung",
    "expense",
    "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    true,
  );
  /** Inserts a booking directly (any rate, regardless of the year's status). */
  const addBooking = (
    date: string,
    categoryId: number,
    type: BookingType,
    grossCents: number,
    vatRate: VatRate | null,
  ) => {
    const input: BookingInput = {
      date,
      type,
      ...splitGross(grossCents, vatRate),
      categoryId,
      description: "x",
      counterparty: "y",
      reference: null,
      note: null,
      source: "manual",
      externalId: null,
    };
    return repositories.bookings.insert(input);
  };
  const service = createEuerService({ unitOfWork });
  return { repositories, unitOfWork, service, addBooking, sales, software, refund };
}

describe("EuerService.calculate", () => {
  it("rejects invalid years without database access", async () => {
    const unitOfWork: UnitOfWork = {
      run: () => Promise.reject(new Error("no database access expected")),
    };
    const service = createEuerService({ unitOfWork });
    for (const year of [Number.NaN, 999, 10000, 2025.5, Infinity]) {
      expect(await service.calculate(year)).toEqual({
        ok: false,
        reason: "invalid",
        errors: [{ field: "year", code: "invalidYear" }],
      });
    }
  });

  it("treats a year without record as regularly taxed and counts only its bookings", async () => {
    const { service, addBooking, sales, software } = await setup();
    await addBooking("2024-12-31", sales.id, "income", 99900, "19");
    await addBooking("2025-01-01", sales.id, "income", 11900, "19");
    await addBooking("2025-12-31", software.id, "expense", 1190, "19");
    await addBooking("2026-01-01", software.id, "expense", 99900, "19");

    const result = await service.calculate(2025);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.euer).toMatchObject({
      year: 2025,
      smallBusiness: false,
      hasLineMapping: true,
      totals: { incomeCents: 11900, expenseCents: 1190, profitCents: 10710 },
      warnings: [],
    });
    expect(result.euer.income.map((line) => [line.line, line.amountCents])).toEqual([
      [15, 10000],
      [17, 1900],
    ]);
    expect(result.euer.expenses.map((line) => [line.line, line.amountCents])).toEqual([
      [50, 1000],
      [57, 190],
    ]);
  });

  it("uses the recorded tax status of the year", async () => {
    const { repositories, service, addBooking, sales, software } = await setup();
    await repositories.taxYears.upsert({ year: 2025, smallBusiness: true });
    await addBooking("2025-03-01", sales.id, "income", 11900, null);
    await addBooking("2025-03-02", software.id, "expense", 1190, "19"); // mismatched

    const result = await service.calculate(2025);
    if (!result.ok) throw new Error("expected ok");
    expect(result.euer.smallBusiness).toBe(true);
    expect(result.euer.income.map((line) => [line.position, line.amountCents])).toEqual([
      ["BETRIEBSEINNAHMEN_KLEINUNTERNEHMER", 11900],
    ]);
    expect(result.euer.expenses.map((line) => [line.position, line.amountCents])).toEqual([
      ["EDV_KOSTEN", 1190],
    ]);
    expect(result.euer.warnings).toEqual([{ code: "vatRateInSmallBusinessYear", bookingCount: 1 }]);

    // An explicitly regular record behaves like no record.
    await repositories.taxYears.upsert({ year: 2025, smallBusiness: false });
    const regular = await service.calculate(2025);
    if (!regular.ok) throw new Error("expected ok");
    expect(regular.euer.smallBusiness).toBe(false);
    expect(regular.euer.warnings).toEqual([
      { code: "vatRateMissingInRegularYear", bookingCount: 1 },
    ]);
  });

  it("counts bookings of archived categories and uses the current position and flag", async () => {
    const { repositories, service, addBooking, sales, software, refund } = await setup();
    await addBooking("2025-05-01", sales.id, "income", 11900, "19");
    await addBooking("2025-05-02", software.id, "expense", 1000, "0");
    await addBooking("2025-05-03", refund.id, "expense", 1190, "19");
    await repositories.categories.setArchived(software.id, true);
    // Position changes apply retroactively (#15).
    await repositories.categories.update(software.id, { euerPosition: "ARBEITSMITTEL" });

    const result = await service.calculate(2025);
    if (!result.ok) throw new Error("expected ok");
    expect(result.euer.expenses).toEqual([
      expect.objectContaining({
        position: "ARBEITSMITTEL",
        amountCents: 1000,
        contributions: [expect.objectContaining({ categoryId: software.id })],
      }),
    ]);
    expect(result.euer.income.map((line) => [line.position, line.amountCents])).toEqual([
      ["BETRIEBSEINNAHMEN_UST_PFLICHTIG", 9000],
      ["UST_VEREINNAHMT", 1710],
    ]);
  });

  it("calculates an empty year and a year without line mapping", async () => {
    const { service, addBooking, sales } = await setup();
    await addBooking("2024-02-02", sales.id, "income", 500, "0");

    const empty = await service.calculate(2030);
    if (!empty.ok) throw new Error("expected ok");
    expect(empty.euer).toMatchObject({
      income: [],
      expenses: [],
      informational: [],
      hasLineMapping: false,
      totals: { incomeCents: 0, expenseCents: 0, profitCents: 0 },
    });

    const unmapped = await service.calculate(2024);
    if (!unmapped.ok) throw new Error("expected ok");
    expect(unmapped.euer.income).toEqual([
      expect.objectContaining({ position: "BETRIEBSEINNAHMEN_UST_FREI", amountCents: 500 }),
    ]);
    expect(unmapped.euer.income[0]).not.toHaveProperty("line");
  });
});
