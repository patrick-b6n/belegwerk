import { Download, Loader2 } from "lucide-react";

import type { BookingQuery } from "@/business/bookings";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { toast } from "@/ui/components/ui/toast";

import { todayIsoDate } from "./booking-form-model";
import { bookingCsvLabels } from "./booking-messages";
import { useBookingCsvExport } from "./booking-queries";

/**
 * "Export CSV" (#24): saves **all** bookings of the current filters in
 * the list's sort order (not just the page) via the save dialog.
 *
 * - Disabled while the filters are invalid, while nothing is loaded yet, if
 *   nothing matches and while an export runs (then with a spinner). It stays
 *   focusable, the reason is in the tooltip.
 * - Success: toast with the number of bookings and the file name. Cancelling
 *   the dialog shows nothing; errors show an error toast.
 */
export function BookingExportButton({
  query,
  total,
  invalid,
}: Readonly<{
  /** Filters and sort order of the list (page and page size are ignored). */
  query: BookingQuery;
  /** Number of matching bookings; `undefined` while not loaded. */
  total: number | undefined;
  invalid: boolean;
}>) {
  const csvExport = useBookingCsvExport();
  const running = csvExport.isPending;
  const disabled = invalid || total === undefined || total === 0 || running;
  const hint = invalid
    ? m.bookings_export_hint_invalid()
    : total === 0
      ? m.bookings_export_hint_empty()
      : m.bookings_export_hint();

  const runExport = async () => {
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
      // Invalid filters disable the button; a result for them is a race.
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

  return (
    <Button
      variant="outline"
      title={hint}
      disabled={disabled}
      // Stays focusable while the export runs (the focus would fall back to
      // the page) and shows its tooltip when disabled.
      focusableWhenDisabled
      aria-busy={running || undefined}
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-background"
      onClick={() => void runExport()}
    >
      {running ? <Loader2 aria-hidden className="animate-spin" /> : <Download aria-hidden />}
      {running ? m.bookings_export_running() : m.bookings_export()}
    </Button>
  );
}
