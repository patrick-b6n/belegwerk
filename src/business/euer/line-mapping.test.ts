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
      BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR: 13,
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

  it("maps 2026 to the lines of the Anlage EÜR 2026", () => {
    const lines = Object.fromEntries(
      Object.entries(EUER_LINE_MAPPINGS[2026]!).map(([position, entry]) => [position, entry.line]),
    );
    // Verified against the official form (BMF-Schreiben vom 01.09.2026), see line-mapping.ts.
    expect(lines).toEqual({
      BETRIEBSEINNAHMEN_KLEINUNTERNEHMER: 12,
      BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR: 13,
      BETRIEBSEINNAHMEN_UST_PFLICHTIG: 15,
      BETRIEBSEINNAHMEN_UST_FREI: 16,
      UST_VEREINNAHMT: 17,
      UST_ERSTATTUNG: 18,
      WAREN: 29,
      FREMDLEISTUNGEN: 30,
      GWG: 37,
      MIETE_GESCHAEFTSRAEUME: 40,
      TELEKOMMUNIKATION: 44,
      REISENEBENKOSTEN: 45,
      FORTBILDUNG: 46,
      RECHTS_STEUERBERATUNG: 47,
      MIETE_LEASING_BEWEGLICH: 48,
      BEITRAEGE_VERSICHERUNGEN: 50,
      EDV_KOSTEN: 51,
      ARBEITSMITTEL: 52,
      WERBUNG: 55,
      VORSTEUER: 58,
      UST_AN_FA: 59,
      SONSTIGE_AUSGABEN: 61,
      BEWIRTUNG: 64,
      VERPFLEGUNGSMEHRAUFWAND: 65,
      FAHRTKOSTEN: 71,
      FAHRTKOSTEN_PRIVATFAHRZEUG: 72,
    });
  });

  it("uses the same labels in 2025 and 2026", () => {
    for (const position of EUER_POSITIONS) {
      expect(EUER_LINE_MAPPINGS[2026]![position]?.label).toBe(
        EUER_LINE_MAPPINGS[2025]![position]?.label,
      );
    }
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

  it.each([2025, 2026])("maps every position for %i", (year) => {
    for (const position of EUER_POSITIONS) {
      expect(EUER_LINE_MAPPINGS[year]![position]).toBeDefined();
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
    expect(describePosition("TELEKOMMUNIKATION", 2026)).toEqual({
      position: "TELEKOMMUNIKATION",
      line: 44,
      label: "Aufwendungen für Telekommunikation (z. B. Telefon, Internet)",
    });
    expect(describePosition("UST_ERSTATTUNG", 2026)).toEqual({
      position: "UST_ERSTATTUNG",
      line: 18,
      label: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer",
    });
    expect(describePosition("SONSTIGE_AUSGABEN", 2026)).toEqual({
      position: "SONSTIGE_AUSGABEN",
      line: 61,
      label:
        "Übrige unbeschränkt abziehbare Betriebsausgaben " +
        "(auch zurückgezahlte Hilfen/Zuschüsse aufgrund der Corona-Pandemie)",
    });
  });

  it("returns only the position for a year without mapping", () => {
    expect(describePosition("GWG", 2024)).toEqual({ position: "GWG" });
    expect(describePosition("GWG", 2030)).toEqual({ position: "GWG" });
  });
});
