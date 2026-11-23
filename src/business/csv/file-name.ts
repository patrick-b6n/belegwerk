import { safeFileNamePart } from "../files";

/** Parts of a suggested export file name; texts come from the UI. */
export interface CsvFileNameParts {
  /** What is exported, e.g. `"buchungen"`. */
  readonly base: string;
  /** Start of the exported period (`YYYY-MM-DD`), if limited. */
  readonly dateFrom?: string | undefined;
  /** End of the exported period (`YYYY-MM-DD`), if limited. */
  readonly dateTo?: string | undefined;
  /** Today (`YYYY-MM-DD`): names an export without a period. */
  readonly today: string;
  /** Word before an open-ended start, e.g. `"ab"`. */
  readonly fromWord: string;
  /** Word before an open-ended end, e.g. `"bis"`. */
  readonly toWord: string;
}

/**
 * Suggested name of an export file, after the exported period:
 * `buchungen-2025-01-01_2025-12-31.csv`, `buchungen-ab-2025-01-01.csv`,
 * `buchungen-bis-2025-12-31.csv`; without a period the export date,
 * `buchungen-2026-11-14.csv`. ISO dates sort correctly and contain no
 * characters Windows forbids; characters it forbids in the texts become `_`.
 */
export function csvFileName({
  base,
  dateFrom,
  dateTo,
  today,
  fromWord,
  toWord,
}: CsvFileNameParts): string {
  let period: string;
  if (dateFrom !== undefined && dateTo !== undefined) period = `${dateFrom}_${dateTo}`;
  else if (dateFrom !== undefined) period = `${fromWord}-${dateFrom}`;
  else if (dateTo !== undefined) period = `${toWord}-${dateTo}`;
  else period = today;
  return `${safeFileNamePart(base)}-${safeFileNamePart(period)}.csv`;
}

/**
 * Suggested name of a yearly export file (EÜR, #27): `euer-2025.csv`;
 * characters Windows forbids in `base` become `_`.
 */
export function yearCsvFileName(base: string, year: number): string {
  return `${safeFileNamePart(base)}-${year}.csv`;
}
