import { describe, expect, it } from "vitest";

import { TEST_EUER_CSV_LABELS as LABELS } from "../__tests__/euer-csv-labels";
import { CSV_BOM, CSV_LINE_ENDING } from "../csv";
import type { VatRate } from "../model";
import { splitGross } from "../money";
import type { BookingGroupSums } from "../repositories";
import { calculateEuer, type EuerCategory, type EuerResult } from "./calculate-euer";
import { EUER_CSV_COLUMNS, type EuerCsvLabels, euerToCsv } from "./euer-csv";

const SALES = 1;
const TAX_FREE = 2;
const SOFTWARE = 10;
const ENTERTAINMENT = 11;
const REFUND = 14;

const CATEGORIES: readonly EuerCategory[] = [
  {
    id: SALES,
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: false,
  },
  {
    id: TAX_FREE,
    type: "income",
    euerPosition: "BETRIEBSEINNAHMEN_UST_FREI",
    reducesIncome: false,
  },
  { id: SOFTWARE, type: "expense", euerPosition: "EDV_KOSTEN", reducesIncome: false },
  { id: ENTERTAINMENT, type: "expense", euerPosition: "BEWIRTUNG", reducesIncome: false },
  {
    id: REFUND,
    type: "expense",
    euerPosition: "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
    reducesIncome: true,
  },
];

const TYPE_OF = new Map(CATEGORIES.map(({ id, type }) => [id, type]));

function group(categoryId: number, vatRate: VatRate | null, grossCents: number, count = 1) {
  const { netCents, vatCents } = splitGross(grossCents, vatRate);
  return {
    categoryId,
    type: TYPE_OF.get(categoryId) ?? "income",
    vatRate,
    count,
    grossCents,
    netCents,
    vatCents,
  } satisfies BookingGroupSums;
}

function euer(year: number, smallBusiness: boolean, groups: BookingGroupSums[]): EuerResult {
  return calculateEuer({ year, smallBusiness, groups, categories: CATEGORIES });
}

const HEADER = "Bereich;Zeile;Bezeichnung;Betrag;Nicht abziehbar";

/** The rows of the file (without BOM and the empty string after the last CRLF). */
function rows(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const lines = csv.slice(CSV_BOM.length).split(CSV_LINE_ENDING);
  expect(lines.at(-1)).toBe("");
  return lines.slice(0, -1);
}

describe("euerToCsv", () => {
  it("has the columns in file order", () => {
    expect(EUER_CSV_COLUMNS).toEqual(["section", "line", "label", "amount", "nonDeductible"]);
  });

  it("writes a regular year: income, expenses (Bewirtung split), totals", () => {
    const result = euer(2026, false, [
      group(SALES, "19", 1190_00),
      group(SALES, "0", 500_00),
      group(REFUND, "19", 119_00),
      group(SOFTWARE, "19", 23_80),
      group(ENTERTAINMENT, "19", 119_00),
    ]);
    expect(rows(euerToCsv(result, LABELS))).toEqual([
      HEADER,
      "Betriebseinnahmen;15;Umsatzsteuerpflichtige Betriebseinnahmen (ohne solche zum ermäßigten Steuersatz von 0 %);900,00;",
      "Betriebseinnahmen;16;Betriebseinnahmen, die umsatzsteuerfrei (§ 4 UStG) oder nicht umsatzsteuerbar sind oder nach § 12 Abs. 3 UStG dem ermäßigten Steuersatz von 0 % unterliegen oder für die der Leistungsempfänger die Umsatzsteuer nach § 13b UStG schuldet;500,00;",
      "Betriebseinnahmen;17;Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben;171,00;",
      "Betriebsausgaben;51;Laufende EDV-Kosten (z. B. Beratung, Wartung, Reparatur);20,00;",
      "Betriebsausgaben;58;Gezahlte und nach § 15 UStG abziehbare Vorsteuerbeträge;22,80;",
      "Betriebsausgaben;64;Bewirtungsaufwendungen;70,00;30,00",
      "Ergebnis;;Summe Betriebseinnahmen;1571,00;",
      "Ergebnis;;Summe Betriebsausgaben;112,80;",
      "Ergebnis;;Gewinn;1458,20;",
    ]);
  });

  it("writes a small-business year with line 13 as informational row after line 12", () => {
    const result = euer(2025, true, [
      group(SALES, null, 1000_00, 3),
      group(TAX_FREE, null, 200_00),
      group(SOFTWARE, null, 50_00),
    ]);
    const lines = rows(euerToCsv(result, LABELS));
    expect(lines.map((row) => row.split(";").slice(0, 2).join(";"))).toEqual([
      "Bereich;Zeile",
      "Betriebseinnahmen;12",
      "Betriebseinnahmen (nachrichtlich);13",
      "Betriebsausgaben;50",
      "Ergebnis;",
      "Ergebnis;",
      "Ergebnis;",
    ]);
    expect(lines[2]?.split(";").at(3)).toBe("200,00");
    // Line 13 is not summed: income total = line 12.
    expect(lines.slice(-3)).toEqual([
      "Ergebnis;;Summe Betriebseinnahmen;1200,00;",
      "Ergebnis;;Summe Betriebsausgaben;50,00;",
      "Ergebnis;;Gewinn;1150,00;",
    ]);
  });

  it("writes a loss and negative lines as plain negative numbers", () => {
    const result = euer(2026, false, [
      group(SALES, "19", 119_00),
      group(REFUND, "19", 238_00),
      group(SOFTWARE, "19", 119_00),
    ]);
    const lines = rows(euerToCsv(result, LABELS));
    expect(lines[1]).toMatch(/^Betriebseinnahmen;15;[^;]+;-100,00;$/);
    expect(lines.at(-1)).toBe("Ergebnis;;Verlust;-238,00;");
  });

  it("writes zero as 'weder Gewinn noch Verlust'", () => {
    const result = euer(2026, false, [group(SALES, "0", 100_00), group(SOFTWARE, "0", 100_00)]);
    expect(rows(euerToCsv(result, LABELS)).at(-1)).toBe(
      "Ergebnis;;Weder Gewinn noch Verlust;0,00;",
    );
  });

  it("leaves the line empty and uses the display name for a year without mapping", () => {
    const result = euer(2024, false, [group(SALES, "19", 119_00)]);
    expect(result.hasLineMapping).toBe(false);
    expect(rows(euerToCsv(result, LABELS)).slice(1, 3)).toEqual([
      "Betriebseinnahmen;;Name BETRIEBSEINNAHMEN_UST_PFLICHTIG;100,00;",
      "Betriebseinnahmen;;Name UST_VEREINNAHMT;19,00;",
    ]);
  });

  it("gives header and zero totals for a year without lines", () => {
    expect(rows(euerToCsv(euer(2026, false, []), LABELS))).toEqual([
      HEADER,
      "Ergebnis;;Summe Betriebseinnahmen;0,00;",
      "Ergebnis;;Summe Betriebsausgaben;0,00;",
      "Ergebnis;;Weder Gewinn noch Verlust;0,00;",
    ]);
  });

  it("quotes and formula-guards label texts like every CSV", () => {
    const labels: EuerCsvLabels = {
      ...LABELS,
      sections: { ...LABELS.sections, result: "Ergebnis; gesamt" },
      totals: { ...LABELS.totals, profit: "=Gewinn" },
    };
    const result = euer(2026, false, [group(SALES, "0", 100_00)]);
    expect(rows(euerToCsv(result, labels)).at(-1)).toBe('"Ergebnis; gesamt";;\'=Gewinn;100,00;');
  });

  it("writes amounts without thousands separator", () => {
    const result = euer(2026, false, [group(SALES, "0", 1_234_567_89)]);
    expect(rows(euerToCsv(result, LABELS))[1]).toMatch(/;1234567,89;$/);
  });
});
