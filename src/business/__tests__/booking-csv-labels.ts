import type { BookingCsvLabels } from "../bookings/booking-csv";

/** Labels for booking CSV tests (the app takes them from Paraglide). */
export const TEST_CSV_LABELS: BookingCsvLabels = {
  columns: {
    date: "Datum",
    type: "Art",
    description: "Beschreibung",
    counterparty: "Gegenpartei",
    category: "Kategorie",
    netCents: "Netto",
    vatRate: "USt-Satz",
    vatCents: "USt",
    grossCents: "Brutto",
    reference: "Referenz",
    note: "Notiz",
    source: "Quelle",
    externalId: "Externe ID",
  },
  types: { income: "Einnahme", expense: "Ausgabe" },
  vatRates: { "19": "19 %", "7": "7 %", "0": "0 %", reverse_charge: "Reverse Charge" },
  sources: { manual: "Manuell", stripe: "Stripe" },
};
