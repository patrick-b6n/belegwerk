import { Download, Loader2 } from "lucide-react";

import type { EuerResult } from "@/business/euer";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { toast } from "@/ui/components/ui/toast";

import { isEmptyEuer } from "./euer-model";
import { euerCsvLabels } from "./euer-messages";
import { useEuerCsvExport } from "./euer-queries";

/**
 * "CSV exportieren" on `/euer` (#27): saves the EÜR of the shown year via
 * the save dialog (same pattern as the booking export, #24).
 *
 * - Disabled while the EÜR is not calculated (loading or error), for a year
 *   without lines and while an export runs (then with a spinner). It stays
 *   focusable, the reason is in the tooltip.
 * - Success: toast with year and file name. Cancelling the dialog shows
 *   nothing; errors show an error toast.
 */
export function EuerExportButton({
  year,
  result,
}: Readonly<{
  year: number;
  /** The EÜR shown; `undefined` while loading or after an error. */
  result: EuerResult | undefined;
}>) {
  const csvExport = useEuerCsvExport();
  const running = csvExport.isPending;
  const empty = result !== undefined && isEmptyEuer(result);
  const disabled = result === undefined || empty || running;
  const hint =
    result === undefined
      ? m.euer_export_hint_unavailable()
      : empty
        ? m.euer_export_hint_empty({ year: String(year) })
        : m.euer_export_hint({ year: String(year) });

  const runExport = async () => {
    try {
      const exported = await csvExport.mutateAsync({
        year,
        labels: euerCsvLabels(),
        fileNameBase: m.euer_export_file_base(),
        filterName: m.bookings_export_file_type(),
      });
      // The year comes from a validated param; an invalid result is a programmer error.
      if (!exported.ok) throw new Error(`EÜR export failed: ${JSON.stringify(exported)}`);
      if (!exported.saved) return;
      toast.add({
        title: m.euer_export_saved_toast(),
        description: m.euer_export_saved({
          year: String(exported.year),
          fileName: exported.fileName,
        }),
        type: "success",
      });
    } catch (error) {
      console.error("EÜR CSV export failed", error);
      toast.add({ title: m.euer_export_error(), type: "error" });
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
      {running ? m.euer_export_running() : m.euer_export()}
    </Button>
  );
}
