/**
 * CSV export of bookings (#24): maps the bookings of a search to rows of the
 * shared CSV format (`src/business/csv`).
 */

import { type CsvCell, csvLiteral, type CsvRow, toCsv } from "../csv";
import { formatAmountPlain, formatDate } from "../format";
import type { BookingSource, BookingType, VatRate } from "../model";
import type { BookingListItem } from "./booking-service";

/** The columns of the booking export, in file order. */
export const BOOKING_CSV_COLUMNS = [
  "date",
  "type",
  "description",
  "counterparty",
  "category",
  "netCents",
  "vatRate",
  "vatCents",
  "grossCents",
  "reference",
  "note",
  "source",
  "externalId",
] as const;

export type BookingCsvColumn = (typeof BOOKING_CSV_COLUMNS)[number];

/**
 * Texts of the export: column headers and the labels of the coded values.
 * They are UI texts (Paraglide), so the UI passes them in.
 */
export interface BookingCsvLabels {
  readonly columns: Readonly<Record<BookingCsvColumn, string>>;
  readonly types: Readonly<Record<BookingType, string>>;
  readonly vatRates: Readonly<Record<VatRate, string>>;
  readonly sources: Readonly<Record<BookingSource, string>>;
}

const amount = (cents: number) => csvLiteral(formatAmountPlain(cents));

function bookingRow(booking: BookingListItem, labels: BookingCsvLabels): CsvRow {
  const cells: Record<BookingCsvColumn, CsvCell> = {
    date: csvLiteral(formatDate(booking.date)),
    type: labels.types[booking.type],
    description: booking.description,
    counterparty: booking.counterparty,
    category: booking.category.name,
    netCents: amount(booking.netCents),
    // No rate (small business year) stays empty.
    vatRate: booking.vatRate === null ? null : labels.vatRates[booking.vatRate],
    vatCents: amount(booking.vatCents),
    grossCents: amount(booking.grossCents),
    reference: booking.reference,
    note: booking.note,
    source: labels.sources[booking.source],
    externalId: booking.externalId,
  };
  return BOOKING_CSV_COLUMNS.map((column) => cells[column]);
}

/**
 * The CSV file of `bookings` in their order: a header row, then one row per
 * booking. Dates `TT.MM.JJJJ`; amounts (net, VAT, gross) as plain numbers
 * with a decimal comma and without thousands separator or `€` (`1234,56`),
 * so spreadsheets read them as numbers. Texts are written as stored
 * (formula-guarded, see `toCsv`); empty optional fields are empty.
 */
export function bookingsToCsv(
  bookings: readonly BookingListItem[],
  labels: BookingCsvLabels,
): string {
  const header = BOOKING_CSV_COLUMNS.map((column) => labels.columns[column]);
  return toCsv([header, ...bookings.map((booking) => bookingRow(booking, labels))]);
}
