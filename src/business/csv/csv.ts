/**
 * CSV writer for the exports (bookings #24, EÜR #27): one format for every
 * file, made for Excel/LibreOffice with German settings.
 *
 * - **Separator** `;` (Excel's list separator in de-DE; `,` is the decimal
 *   separator there).
 * - **Line endings** CRLF after every row, including the last (RFC 4180;
 *   Excel on Windows).
 * - **Encoding:** the text starts with a byte order mark (U+FEFF). Written as
 *   UTF-8 it becomes `EF BB BF`, by which Excel recognises UTF-8 (without it,
 *   umlauts break). The writer adds it, so every export has it exactly once;
 *   callers write the string as UTF-8 unchanged.
 * - **Quoting** (RFC 4180): a field containing `;`, `"`, CR or LF is enclosed
 *   in double quotes, inner quotes are doubled. Other fields are written as
 *   they are – leading/trailing spaces stay (Excel keeps them either way).
 * - **Formula injection** (OWASP "CSV Injection"): a text cell starting with
 *   `=`, `+`, `-`, `@` (also after leading whitespace), tab or CR would be
 *   evaluated as a formula by a spreadsheet. Such texts get a leading apostrophe (`'=1+1`), which shows
 *   them as text. This changes the value visibly (e.g. `'-Rabatt`) – accepted,
 *   it only affects texts users typed or imported. Values the app formats
 *   itself (amounts like `-12,50`, dates) are {@link CsvLiteral}s and are
 *   written unchanged, so negative amounts stay numbers.
 */

/** Byte order mark; UTF-8 encoded `EF BB BF`. */
export const CSV_BOM = "\uFEFF";
export const CSV_SEPARATOR = ";";
export const CSV_LINE_ENDING = "\r\n";

/**
 * A value formatted by the app itself (amount, date): written without the
 * formula guard. Still quoted if needed. Create with {@link csvLiteral}.
 */
export interface CsvLiteral {
  readonly literal: string;
}

/**
 * One field: a text (user data or labels, formula-guarded), a
 * {@link CsvLiteral}, or `null` for an empty field.
 */
export type CsvCell = string | CsvLiteral | null;

export type CsvRow = readonly CsvCell[];

/** Marks an app-formatted value (amount, date) as safe from the formula guard. */
export function csvLiteral(value: string): CsvLiteral {
  return { literal: value };
}

// Characters that make a spreadsheet treat a cell as a formula (OWASP), also
// after leading whitespace (some spreadsheets trim before evaluating).
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;
const NEEDS_QUOTES = /[;"\r\n]/;

function escapeField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function cellText(cell: CsvCell): string {
  if (cell === null) return "";
  if (typeof cell === "string") return FORMULA_START.test(cell) ? `'${cell}` : cell;
  return cell.literal;
}

/**
 * The complete file content: BOM, then every row as `;`-separated fields,
 * each row ended by CRLF. Rows may have different lengths. No rows give just
 * the BOM.
 */
export function toCsv(rows: readonly CsvRow[]): string {
  let csv = CSV_BOM;
  for (const row of rows) {
    csv += row.map((cell) => escapeField(cellText(cell))).join(CSV_SEPARATOR) + CSV_LINE_ENDING;
  }
  return csv;
}
