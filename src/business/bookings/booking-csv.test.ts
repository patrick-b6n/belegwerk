import { describe, expect, it } from "vitest";

import { TEST_CSV_LABELS } from "../__tests__/booking-csv-labels";
import { CSV_BOM } from "../csv";
import { MAX_AMOUNT_CENTS } from "../money";
import { BOOKING_CSV_COLUMNS, bookingsToCsv } from "./booking-csv";
import type { BookingListItem } from "./booking-service";

function item(overrides: Partial<BookingListItem> = {}): BookingListItem {
  return {
    id: 1,
    date: "2025-03-07",
    type: "income",
    grossCents: 11900,
    vatRate: "19",
    netCents: 10000,
    vatCents: 1900,
    categoryId: 3,
    category: { id: 3, name: "Umsatzerlöse", archived: false },
    description: "Beratung",
    counterparty: "Müller GmbH",
    reference: "RE-1",
    note: null,
    source: "manual",
    externalId: null,
    createdAt: "2025-03-07T12:00:00.000Z",
    updatedAt: "2025-03-07T12:00:00.000Z",
    ...overrides,
  };
}

/** Rows of the file without BOM, split at CRLF (no field in these tests contains one). */
function lines(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const rows = csv.slice(CSV_BOM.length).split("\r\n");
  expect(rows.pop()).toBe("");
  return rows;
}

describe("bookingsToCsv", () => {
  it("writes the header with the given labels in column order", () => {
    expect(lines(bookingsToCsv([], TEST_CSV_LABELS))).toEqual([
      "Datum;Art;Beschreibung;Gegenpartei;Kategorie;Netto;USt-Satz;USt;Brutto;Referenz;Notiz;Quelle;Externe ID",
    ]);
    expect(BOOKING_CSV_COLUMNS).toHaveLength(13);
  });

  it("writes one row per booking with formatted date, labels and amounts", () => {
    expect(lines(bookingsToCsv([item()], TEST_CSV_LABELS))[1]).toBe(
      "07.03.2025;Einnahme;Beratung;Müller GmbH;Umsatzerlöse;100,00;19 %;19,00;119,00;RE-1;;Manuell;",
    );
  });

  it("keeps the order of the bookings", () => {
    const rows = lines(
      bookingsToCsv(
        [item({ description: "B" }), item({ description: "A" }), item({ description: "C" })],
        TEST_CSV_LABELS,
      ),
    );
    expect(rows.slice(1).map((row) => row.split(";")[2])).toEqual(["B", "A", "C"]);
  });

  it("maps expense, other VAT rates, Stripe and the external ID", () => {
    const row = lines(
      bookingsToCsv(
        [
          item({
            type: "expense",
            vatRate: "reverse_charge",
            netCents: 5000,
            vatCents: 0,
            grossCents: 5000,
            source: "stripe",
            externalId: "fee_123",
            category: { id: 9, name: "Gebühren", archived: true },
          }),
        ],
        TEST_CSV_LABELS,
      ),
    )[1];
    expect(row).toBe(
      "07.03.2025;Ausgabe;Beratung;Müller GmbH;Gebühren;50,00;Reverse Charge;0,00;50,00;RE-1;;Stripe;fee_123",
    );
  });

  it("leaves the VAT rate empty without a rate (small business) and null texts empty", () => {
    const row = lines(
      bookingsToCsv(
        [item({ vatRate: null, netCents: 11900, vatCents: 0, reference: null, note: null })],
        TEST_CSV_LABELS,
      ),
    )[1];
    expect(row?.split(";")).toEqual([
      "07.03.2025",
      "Einnahme",
      "Beratung",
      "Müller GmbH",
      "Umsatzerlöse",
      "119,00",
      "",
      "0,00",
      "119,00",
      "",
      "",
      "Manuell",
      "",
    ]);
  });

  it("formats large amounts exactly, without thousands separator", () => {
    const row = lines(
      bookingsToCsv(
        [
          item({
            grossCents: MAX_AMOUNT_CENTS,
            netCents: 8_403_361_345,
            vatCents: 1_596_638_655,
          }),
        ],
        TEST_CSV_LABELS,
      ),
    )[1];
    expect(row?.split(";").slice(5, 9)).toEqual([
      "84033613,45",
      "19 %",
      "15966386,55",
      "100000000,00",
    ]);
  });

  it("quotes texts with separators, quotes and line breaks", () => {
    const csv = bookingsToCsv(
      [item({ description: 'Beratung; "Projekt X"', note: "Zeile 1\nZeile 2" })],
      TEST_CSV_LABELS,
    );
    expect(csv).toContain(';"Beratung; ""Projekt X""";');
    expect(csv).toContain(';"Zeile 1\nZeile 2";');
  });

  it("guards texts against formula injection but not amounts or dates", () => {
    const row = lines(
      bookingsToCsv(
        [item({ description: "=1+1", counterparty: "@evil", reference: "-5", note: "+x" })],
        TEST_CSV_LABELS,
      ),
    )[1];
    expect(row).toBe(
      "07.03.2025;Einnahme;'=1+1;'@evil;Umsatzerlöse;100,00;19 %;19,00;119,00;'-5;'+x;Manuell;",
    );
  });
});
