import type { BookingQuery } from "@/business/bookings";
import { m } from "@/paraglide/messages.js";
import { toast } from "@/ui/components/ui/toast";

import { todayIsoDate } from "./booking-form-model";
import { bookingCsvLabels } from "./booking-messages";
import { useBookingCsvExport } from "./booking-queries";

export interface BookingExportAction {
  /** Whether the export cannot run now (see `hint` for why). */
  readonly disabled: boolean;
  readonly running: boolean;
  /** Tooltip: what the export does, or why it is disabled. */
  readonly hint: string;
  readonly run: () => Promise<void>;
}

/**
 * "Export CSV" (#24), used by the booking list's "…" menu: saves **all**
 * bookings of the current filters in the list's sort order (not just the
 * page) via the save dialog.
 *
 * - Disabled while the filters are invalid, while nothing is loaded yet, if
 *   nothing matches and while an export runs; `hint` names the reason.
 * - Success: toast with the number of bookings and the file name. Cancelling
 *   the dialog shows nothing; errors show an error toast.
 */
export function useBookingExportAction({
  query,
  total,
  invalid,
}: Readonly<{
  /** Filters and sort order of the list (page and page size are ignored). */
  query: BookingQuery;
  /** Number of matching bookings; `undefined` while not loaded. */
  total: number | undefined;
  invalid: boolean;
}>): BookingExportAction {
  const csvExport = useBookingCsvExport();
  const running = csvExport.isPending;
  const disabled = invalid || total === undefined || total === 0 || running;
  const hint = invalid
    ? m.bookings_export_hint_invalid()
    : total === 0
      ? m.bookings_export_hint_empty()
      : m.bookings_export_hint();

  const run = async () => {
    try {
      const result = await csvExport.mutateAsync({
        query,
        labels: bookingCsvLabels(),
        fileName: {
          base: m.bookings_export_file_base(),
          today: todayIsoDate(),
          fromWord: m.bookings_export_file_from(),
          toWord: m.bookings_export_file_to(),
        },
        filterName: m.bookings_export_file_type(),
      });
      // Invalid filters disable the action; a result for them is a race.
      if (!result.ok) throw new Error(`Export with invalid filters: ${JSON.stringify(result)}`);
      if (!result.saved) return;
      toast.add({
        title: m.bookings_export_saved_toast(),
        description:
          result.count === 1
            ? m.bookings_export_saved_one({ fileName: result.fileName })
            : m.bookings_export_saved_other({
                count: String(result.count),
                fileName: result.fileName,
              }),
        type: "success",
      });
    } catch (error) {
      console.error("CSV export failed", error);
      toast.add({ title: m.bookings_export_error(), type: "error" });
    }
  };

  return { disabled, running, hint, run };
}
