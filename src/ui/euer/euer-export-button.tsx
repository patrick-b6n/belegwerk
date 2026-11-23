import { Download } from "lucide-react";

import type { EuerResult } from "@/business/euer";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { toast } from "@/ui/components/ui/toast";

import { isEmptyEuer } from "./euer-model";
import { euerCsvLabels } from "./euer-messages";
import { useEuerCsvExport } from "./euer-queries";

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
      busy={running}
      disabled={disabled}
      // Shows its tooltip when disabled.
      focusableWhenDisabled
      onClick={() => void runExport()}
    >
      <Download aria-hidden />
      {running ? m.euer_export_running() : m.euer_export()}
    </Button>
  );
}
