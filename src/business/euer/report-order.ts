import type { EuerReportLine, EuerResult } from "./calculate-euer";

/** An income line in report order; `informational` marks a "davon" line. */
export interface EuerIncomeEntry {
  readonly line: EuerReportLine;
  /** "Davon" line (small business line 13): already part of another line, not summed. */
  readonly informational: boolean;
}

/**
 * The income lines in the order of the form, shared by the view (#26) and
 * the CSV export (#27): by line number, informational lines (line 13,
 * "davon nicht steuerbar") right after line 12
 * (`BETRIEBSEINNAHMEN_KLEINUNTERNEHMER`), which they are part of; without it
 * (cannot happen with #25's rules) they come last.
 */
export function incomeInReportOrder(
  result: Pick<EuerResult, "income" | "informational">,
): EuerIncomeEntry[] {
  const entries: EuerIncomeEntry[] = [];
  const pending = result.informational.map((line) => ({ line, informational: true }));
  for (const line of result.income) {
    entries.push({ line, informational: false });
    if (line.position === "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER") entries.push(...pending.splice(0));
  }
  entries.push(...pending);
  return entries;
}
