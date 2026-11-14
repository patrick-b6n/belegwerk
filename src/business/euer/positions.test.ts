import { describe, expect, it } from "vitest";

import {
  EUER_POSITION_DEFINITIONS,
  EUER_POSITIONS,
  isEuerPosition,
  isTaxOfficePayment,
  positionForTaxStatus,
} from "./positions";

describe("EUER_POSITIONS", () => {
  it("has unique keys in UPPER_SNAKE_CASE with a definition each", () => {
    expect(new Set(EUER_POSITIONS).size).toBe(EUER_POSITIONS.length);
    for (const position of EUER_POSITIONS) {
      expect(position).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
    expect(Object.keys(EUER_POSITION_DEFINITIONS).toSorted()).toEqual(
      [...EUER_POSITIONS].toSorted(),
    );
  });

  it("contains the positions named in #13", () => {
    expect(EUER_POSITIONS).toEqual(
      expect.arrayContaining([
        "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        "UST_VEREINNAHMT",
        "UST_ERSTATTUNG",
        "VORSTEUER",
        "UST_AN_FA",
        "TELEKOMMUNIKATION",
        "GWG",
        "SONSTIGE_AUSGABEN",
      ]),
    );
  });

  it("assigns the VAT positions to the right side", () => {
    expect(EUER_POSITION_DEFINITIONS.UST_VEREINNAHMT.kind).toBe("income");
    expect(EUER_POSITION_DEFINITIONS.UST_ERSTATTUNG.kind).toBe("income");
    expect(EUER_POSITION_DEFINITIONS.VORSTEUER.kind).toBe("expense");
    expect(EUER_POSITION_DEFINITIONS.UST_AN_FA.kind).toBe("expense");
  });

  it("keeps calculated positions away from categories", () => {
    const calculated = EUER_POSITIONS.filter((p) => !EUER_POSITION_DEFINITIONS[p].assignable);
    expect(calculated.toSorted()).toEqual([
      "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
      "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR",
      "UST_VEREINNAHMT",
      "VORSTEUER",
    ]);
  });

  it("marks only the small-business „davon“ line as informational", () => {
    expect(EUER_POSITIONS.filter((p) => EUER_POSITION_DEFINITIONS[p].informational)).toEqual([
      "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR",
    ]);
  });

  it("remaps small-business turnover only within the same side", () => {
    const remapped = EUER_POSITIONS.flatMap((position) => {
      const target = EUER_POSITION_DEFINITIONS[position].smallBusinessPosition;
      return target === undefined ? [] : [[position, target] as const];
    });
    expect(remapped.length).toBeGreaterThan(0);
    for (const [position, target] of remapped) {
      expect(EUER_POSITION_DEFINITIONS[target].kind).toBe(EUER_POSITION_DEFINITIONS[position].kind);
    }
  });
});

describe("isEuerPosition", () => {
  it("accepts known keys only", () => {
    expect(isEuerPosition("GWG")).toBe(true);
    expect(isEuerPosition("gwg")).toBe(false);
    expect(isEuerPosition("")).toBe(false);
    expect(isEuerPosition("toString")).toBe(false);
  });
});

describe("positionForTaxStatus", () => {
  it("keeps every position in a regularly taxed year", () => {
    for (const position of EUER_POSITIONS) {
      expect(positionForTaxStatus(position, false)).toBe(position);
    }
  });

  it("moves all turnover to the small-business line in a small-business year", () => {
    expect(positionForTaxStatus("BETRIEBSEINNAHMEN_UST_PFLICHTIG", true)).toBe(
      "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
    );
    expect(positionForTaxStatus("BETRIEBSEINNAHMEN_UST_FREI", true)).toBe(
      "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
    );
  });

  it("keeps VAT refunds and expenses in a small-business year", () => {
    // Anleitung 2025, line 12: small businesses report everything except lines 18–22 there.
    expect(positionForTaxStatus("UST_ERSTATTUNG", true)).toBe("UST_ERSTATTUNG");
    expect(positionForTaxStatus("TELEKOMMUNIKATION", true)).toBe("TELEKOMMUNIKATION");
    expect(positionForTaxStatus("UST_AN_FA", true)).toBe("UST_AN_FA");
  });
});

describe("isTaxOfficePayment", () => {
  it("is true only for VAT payments to and refunds from the tax office", () => {
    const taxOffice = EUER_POSITIONS.filter((position) => isTaxOfficePayment(position));
    expect(taxOffice).toEqual(["UST_ERSTATTUNG", "UST_AN_FA"]);
    expect(isTaxOfficePayment("NOT_A_POSITION")).toBe(false);
    expect(isTaxOfficePayment("")).toBe(false);
  });
});
