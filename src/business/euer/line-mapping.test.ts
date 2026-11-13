import { describe, expect, it } from "vitest";

import { describePosition, EUER_LINE_MAPPINGS, hasLineMapping } from "./line-mapping";
import { EUER_POSITION_DEFINITIONS, EUER_POSITIONS, isEuerPosition } from "./positions";

describe("EUER_LINE_MAPPINGS", () => {
  it("maps 2025 to the lines of the Anlage EÜR 2025", () => {
    const lines = Object.fromEntries(
      Object.entries(EUER_LINE_MAPPINGS[2025]!).map(([position, entry]) => [position, entry.line]),
    );
    // Verified against the official form (BMF-Schreiben vom 29.08.2025), see line-mapping.ts.
    expect(lines).toEqual({
      BETRIEBSEINNAHMEN_KLEINUNTERNEHMER: 12,
      BETRIEBSEINNAHMEN_UST_PFLICHTIG: 15,
      BETRIEBSEINNAHMEN_UST_FREI: 16,
      UST_VEREINNAHMT: 17,
      UST_ERSTATTUNG: 18,
      WAREN: 27,
      FREMDLEISTUNGEN: 29,
      GWG: 36,
      MIETE_GESCHAEFTSRAEUME: 39,
      TELEKOMMUNIKATION: 43,
      REISENEBENKOSTEN: 44,
      FORTBILDUNG: 45,
      RECHTS_STEUERBERATUNG: 46,
      MIETE_LEASING_BEWEGLICH: 47,
      BEITRAEGE_VERSICHERUNGEN: 49,
      EDV_KOSTEN: 50,
      ARBEITSMITTEL: 51,
      WERBUNG: 54,
      VORSTEUER: 57,
      UST_AN_FA: 58,
      SONSTIGE_AUSGABEN: 60,
      BEWIRTUNG: 63,
      VERPFLEGUNGSMEHRAUFWAND: 64,
      FAHRTKOSTEN: 70,
      FAHRTKOSTEN_PRIVATFAHRZEUG: 71,
    });
  });

  it("uses 2025 provisionally for 2026", () => {
    expect(EUER_LINE_MAPPINGS[2026]).toEqual(EUER_LINE_MAPPINGS[2025]);
  });

  it.each(Object.keys(EUER_LINE_MAPPINGS).map(Number))("has consistent entries for %i", (year) => {
    const mapping = EUER_LINE_MAPPINGS[year]!;
    const entries = Object.entries(mapping);
    const lines = entries.map(([, entry]) => entry.line);
    expect(new Set(lines).size).toBe(lines.length);
    for (const [position, entry] of entries) {
      expect(isEuerPosition(position)).toBe(true);
      expect(Number.isInteger(entry.line) && entry.line > 0).toBe(true);
      expect(entry.label.trim()).toBe(entry.label);
      expect(entry.label).not.toBe("");
    }
    // Income lines (1. Betriebseinnahmen, lines 12–23) come before expense lines.
    for (const [position, entry] of entries) {
      const kind = EUER_POSITION_DEFINITIONS[position as keyof typeof mapping].kind;
      expect(entry.line < 24).toBe(kind === "income");
    }
  });

  it("maps every position for 2025", () => {
    for (const position of EUER_POSITIONS) {
      expect(EUER_LINE_MAPPINGS[2025]![position]).toBeDefined();
    }
  });
});

describe("hasLineMapping", () => {
  it("knows the mapped years", () => {
    expect(hasLineMapping(2025)).toBe(true);
    expect(hasLineMapping(2026)).toBe(true);
    expect(hasLineMapping(2024)).toBe(false);
    expect(hasLineMapping(2027)).toBe(false);
  });
});

describe("describePosition", () => {
  it("returns line and official label for a mapped year", () => {
    expect(describePosition("TELEKOMMUNIKATION", 2025)).toEqual({
      position: "TELEKOMMUNIKATION",
      line: 43,
      label: "Aufwendungen für Telekommunikation (z. B. Telefon, Internet)",
    });
    expect(describePosition("UST_ERSTATTUNG", 2026)).toEqual({
      position: "UST_ERSTATTUNG",
      line: 18,
      label: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer",
    });
  });

  it("returns only the position for a year without mapping", () => {
    expect(describePosition("GWG", 2024)).toEqual({ position: "GWG" });
    expect(describePosition("GWG", 2030)).toEqual({ position: "GWG" });
  });
});
