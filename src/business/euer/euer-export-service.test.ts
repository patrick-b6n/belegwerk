import { describe, expect, it } from "vitest";

import { TEST_EUER_CSV_LABELS } from "../__tests__/euer-csv-labels";
import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import { CSV_BOM } from "../csv";
import type { FileSaver, SaveTextFileRequest, SaveTextFileResult } from "../files";
import { splitGross } from "../money";
import { euerToCsv } from "./euer-csv";
import { createEuerExportService } from "./euer-export-service";
import { createEuerService, type EuerService } from "./euer-service";

function fakeFileSaver(result: (request: SaveTextFileRequest) => SaveTextFileResult) {
  const requests: SaveTextFileRequest[] = [];
  const fileSaver: FileSaver = {
    saveTextFile: async (request) => {
      requests.push(request);
      return result(request);
    },
  };
  return { fileSaver, requests };
}

async function setup(result: (request: SaveTextFileRequest) => SaveTextFileResult) {
  const { repositories, unitOfWork } = createInMemoryDatabase();
  const sales = await repositories.categories.insert({
    name: "Umsatz",
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
    isSystem: false,
  });
  await repositories.bookings.insert({
    date: "2025-03-01",
    type: "income",
    ...splitGross(11900, "19"),
    categoryId: sales.id,
    description: "Beratung",
    counterparty: "Kunde",
    reference: null,
    note: null,
    source: "manual",
    externalId: null,
  });
  const euer = createEuerService({ unitOfWork });
  const saver = fakeFileSaver(result);
  const service = createEuerExportService({ euer, fileSaver: saver.fileSaver });
  const exportCsv = (year: number) =>
    service.exportCsv({
      year,
      labels: TEST_EUER_CSV_LABELS,
      fileNameBase: "euer",
      filterName: "CSV-Datei",
    });
  return { euer, exportCsv, requests: saver.requests };
}

describe("EuerExportService.exportCsv", () => {
  it("saves the year's EÜR as CSV under euer-<year>.csv", async () => {
    const { euer, exportCsv, requests } = await setup(() => ({
      saved: true,
      path: "C:\\Users\\x\\Documents\\EÜR 2025.csv",
    }));

    expect(await exportCsv(2025)).toEqual({
      ok: true,
      saved: true,
      fileName: "EÜR 2025.csv",
      year: 2025,
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.defaultFileName).toBe("euer-2025.csv");
    expect(request.filter).toEqual({ name: "CSV-Datei", extensions: ["csv"] });
    const calculated = await euer.calculate(2025);
    if (!calculated.ok) throw new Error("expected ok");
    expect(request.content).toBe(euerToCsv(calculated.euer, TEST_EUER_CSV_LABELS));
    expect(request.content.startsWith(CSV_BOM)).toBe(true);
    expect(request.content).toContain("Betriebseinnahmen;15;");
  });

  it("reports a cancelled dialog", async () => {
    const { exportCsv, requests } = await setup(() => ({ saved: false }));
    expect(await exportCsv(2025)).toEqual({ ok: true, saved: false });
    expect(requests).toHaveLength(1);
  });

  it("rejects an invalid year without opening the dialog", async () => {
    const { exportCsv, requests } = await setup(() => ({ saved: true, path: "x.csv" }));
    expect(await exportCsv(999)).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "year", code: "invalidYear" }],
    });
    expect(requests).toHaveLength(0);
  });

  it("propagates write errors", async () => {
    const { exportCsv } = await setup(() => {
      throw new Error("locked");
    });
    await expect(exportCsv(2025)).rejects.toThrow("locked");
  });

  it("calculates before the dialog opens", async () => {
    const calls: string[] = [];
    const euer: EuerService = {
      calculate: async (year) => {
        calls.push(`calculate ${year}`);
        return createEuerService({ unitOfWork: createInMemoryDatabase().unitOfWork }).calculate(
          year,
        );
      },
    };
    const service = createEuerExportService({
      euer,
      fileSaver: {
        saveTextFile: async () => {
          calls.push("dialog");
          return { saved: false };
        },
      },
    });
    await service.exportCsv({
      year: 2026,
      labels: TEST_EUER_CSV_LABELS,
      fileNameBase: "euer",
      filterName: "CSV",
    });
    expect(calls).toEqual(["calculate 2026", "dialog"]);
  });
});
