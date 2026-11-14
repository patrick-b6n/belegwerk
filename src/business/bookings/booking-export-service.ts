import { csvFileName, type CsvFileNameParts } from "../csv";
import { fileNameOfPath, type FileSaver } from "../files";
import { type BookingCsvLabels, bookingsToCsv } from "./booking-csv";
import type { BookingQuery, BookingQueryInvalid } from "./booking-query";
import type { BookingService } from "./booking-service";

/** UI texts and today's date for {@link BookingExportService.exportCsv}. */
export interface ExportBookingsCsvRequest {
  /** Filters and sort order of the list; `page`/`pageSize` are ignored (all bookings). */
  readonly query: BookingQuery;
  readonly labels: BookingCsvLabels;
  /** Parts of the suggested file name except the period, which comes from the query. */
  readonly fileName: Omit<CsvFileNameParts, "dateFrom" | "dateTo">;
  /** Name of the dialog's file type filter, e.g. "CSV-Datei". */
  readonly filterName: string;
}

export type ExportBookingsCsvResult =
  /** Saved `count` bookings to the file `fileName` (name only, without directory). */
  | { readonly ok: true; readonly saved: true; readonly fileName: string; readonly count: number }
  /** The user cancelled the save dialog. */
  | { readonly ok: true; readonly saved: false }
  | BookingQueryInvalid;

export interface BookingExportService {
  /**
   * CSV export (#24): **all** bookings matching the query's filters, in its
   * sort order (not just the list's page), via the save dialog.
   * Invalid filters give `{ ok: false, reason: "invalid", errors }` without
   * opening the dialog.
   *
   * @throws if loading or writing fails.
   */
  exportCsv(request: ExportBookingsCsvRequest): Promise<ExportBookingsCsvResult>;
}

export interface BookingExportServiceDependencies {
  readonly bookings: BookingService;
  readonly fileSaver: FileSaver;
}

export function createBookingExportService({
  bookings,
  fileSaver,
}: BookingExportServiceDependencies): BookingExportService {
  return {
    exportCsv: async ({ query, labels, fileName, filterName }) => {
      // Loaded before the dialog: invalid filters never open it, and the file
      // has the state at the time of the click.
      const result = await bookings.list({ ...query, page: 1, pageSize: "all" });
      if (!result.ok) return result;

      const saved = await fileSaver.saveTextFile({
        defaultFileName: csvFileName({
          ...fileName,
          dateFrom: query.dateFrom || undefined,
          dateTo: query.dateTo || undefined,
        }),
        filter: { name: filterName, extensions: ["csv"] },
        content: bookingsToCsv(result.items, labels),
      });
      if (!saved.saved) return { ok: true, saved: false };
      return {
        ok: true,
        saved: true,
        fileName: fileNameOfPath(saved.path),
        count: result.items.length,
      };
    },
  };
}
