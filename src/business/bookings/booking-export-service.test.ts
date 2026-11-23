import { describe, expect, it } from "vitest";

import { TEST_CSV_LABELS } from "../__tests__/booking-csv-labels";
import { createInMemoryDatabase } from "../__tests__/in-memory-repositories";
import { CSV_BOM } from "../csv";
import type { FileSaver, SaveTextFileRequest, SaveTextFileResult } from "../files";
import type { BookingQuery } from "./booking-query";
import { createBookingExportService } from "./booking-export-service";
import { type BookingFormInput, createBookingService } from "./booking-service";

const FILE_NAME = { base: "buchungen", today: "2026-11-14", fromWord: "ab", toWord: "bis" };

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
  const { repositories, unitOfWork } = createInMemoryDatabase({
    clock: () => new Date("2025-03-07T12:00:00Z"),
  });
  const category = await repositories.categories.insert({
    name: "Umsatzerlöse",
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
    isSystem: false,
  });
  const bookings = createBookingService({ unitOfWork });
  const create = async (overrides: Partial<BookingFormInput>) => {
    const created = await bookings.create({
      date: "2025-03-01",
      type: "income",
      grossCents: 11900,
      vatRate: "19",
      categoryId: category.id,
      description: "Beratung",
      counterparty: "Kunde",
      reference: null,
      note: null,
      ...overrides,
    });
    if (!created.ok) throw new Error(JSON.stringify(created));
  };
  const saver = fakeFileSaver(result);
  const service = createBookingExportService({ bookings, fileSaver: saver.fileSaver });
  const exportCsv = (query: BookingQuery) =>
    service.exportCsv({ query, labels: TEST_CSV_LABELS, fileName: FILE_NAME, filterName: "CSV" });
  return { create, exportCsv, requests: saver.requests };
}

const savedTo = (path: string) => () => ({ saved: true, path }) as const;

function descriptions(content: string): string[] {
  return content
    .slice(CSV_BOM.length)
    .split("\r\n")
    .slice(1, -1)
    .map((row) => row.split(";")[2] ?? "");
}

describe("BookingExportService.exportCsv", () => {
  it("exports all matching bookings (not one page) in the query's sort order", async () => {
    const { create, exportCsv, requests } = await setup(
      savedTo("C:\\Users\\x\\Documents\\export.csv"),
    );
    for (let i = 1; i <= 60; i++) {
      await create({ description: `B${String(i).padStart(2, "0")}`, grossCents: i * 100 });
    }
    await create({ description: "Andere", date: "2024-06-01", vatRate: "0" });

    const result = await exportCsv({
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
      sort: { field: "grossCents", direction: "asc" },
      page: 3,
      pageSize: 25,
    });

    expect(result).toEqual({ ok: true, saved: true, fileName: "export.csv", count: 60 });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.defaultFileName).toBe("buchungen-2025-01-01_2025-12-31.csv");
    expect(request?.filter).toEqual({ name: "CSV", extensions: ["csv"] });
    const rows = descriptions(request?.content ?? "");
    expect(rows).toHaveLength(60);
    expect(rows[0]).toBe("B01");
    expect(rows[59]).toBe("B60");
  });

  it("names the file after an open period or today", async () => {
    const { exportCsv, requests } = await setup(savedTo("/tmp/a.csv"));
    await exportCsv({ dateFrom: "2025-01-01" });
    await exportCsv({ dateTo: "2025-06-30" });
    await exportCsv({});
    await exportCsv({ dateFrom: "", dateTo: "" });
    expect(requests.map((request) => request.defaultFileName)).toEqual([
      "buchungen-ab-2025-01-01.csv",
      "buchungen-bis-2025-06-30.csv",
      "buchungen-2026-11-14.csv",
      "buchungen-2026-11-14.csv",
    ]);
  });

  it("exports just the header when nothing matches", async () => {
    const { create, exportCsv, requests } = await setup(savedTo("/tmp/leer.csv"));
    await create({});
    const result = await exportCsv({ text: "gibt es nicht" });
    expect(result).toEqual({ ok: true, saved: true, fileName: "leer.csv", count: 0 });
    expect(descriptions(requests[0]?.content ?? "")).toEqual([]);
  });

  it("reports a cancelled dialog", async () => {
    const { create, exportCsv } = await setup(() => ({ saved: false }));
    await create({});
    expect(await exportCsv({})).toEqual({ ok: true, saved: false });
  });

  it("does not open the dialog for invalid filters", async () => {
    const { exportCsv, requests } = await setup(savedTo("/tmp/x.csv"));
    const result = await exportCsv({ dateFrom: "2025-12-31", dateTo: "2025-01-01" });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "dateTo", code: "dateRangeInverted" }],
    });
    expect(requests).toEqual([]);
  });

  it("passes write errors on", async () => {
    const { exportCsv } = await setup(() => {
      throw new Error("locked");
    });
    await expect(exportCsv({})).rejects.toThrow("locked");
  });
});
