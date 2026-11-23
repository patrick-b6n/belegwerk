import { yearCsvFileName } from "../csv";
import { fileNameOfPath, type FileSaver } from "../files";
import { type EuerCsvLabels, euerToCsv } from "./euer-csv";
import type { CalculateEuerResult, EuerService } from "./euer-service";

export interface ExportEuerCsvRequest {
  readonly year: number;
  readonly labels: EuerCsvLabels;
  /** First part of the suggested file name, e.g. `"euer"` → `euer-2025.csv`. */
  readonly fileNameBase: string;
  /** Name of the dialog's file type filter, e.g. "CSV-Datei". */
  readonly filterName: string;
}

export type ExportEuerCsvResult =
  /** Saved the EÜR of `year` to the file `fileName` (name only, without directory). */
  | { readonly ok: true; readonly saved: true; readonly fileName: string; readonly year: number }
  | { readonly ok: true; readonly saved: false }
  | Extract<CalculateEuerResult, { ok: false }>;

export interface EuerExportService {
  /**
   * CSV export of the EÜR of a year (#27) via the save dialog. Calculated
   * before the dialog opens (the file has the state at the time of the
   * click); an invalid year gives `{ ok: false, reason: "invalid", errors }`
   * without opening it.
   *
   * @throws if calculating or writing fails.
   */
  exportCsv(request: ExportEuerCsvRequest): Promise<ExportEuerCsvResult>;
}

export interface EuerExportServiceDependencies {
  readonly euer: EuerService;
  readonly fileSaver: FileSaver;
}

export function createEuerExportService({
  euer,
  fileSaver,
}: EuerExportServiceDependencies): EuerExportService {
  return {
    exportCsv: async ({ year, labels, fileNameBase, filterName }) => {
      const result = await euer.calculate(year);
      if (!result.ok) return result;

      const saved = await fileSaver.saveTextFile({
        defaultFileName: yearCsvFileName(fileNameBase, year),
        filter: { name: filterName, extensions: ["csv"] },
        content: euerToCsv(result.euer, labels),
      });
      if (!saved.saved) return { ok: true, saved: false };
      return { ok: true, saved: true, fileName: fileNameOfPath(saved.path), year };
    },
  };
}
