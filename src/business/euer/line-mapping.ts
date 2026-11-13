/**
 * Line numbers and official labels of the EÜR positions per tax year (#13).
 *
 * The labels are the line texts of the official form – legal form data like
 * the line numbers, not UI texts (docs/i18n.md). Remarks in the form that are
 * only instructions (references to other lines, the 10-day rule) are left
 * out; examples in parentheses are kept.
 *
 * A position without an entry for a year (or a year without a mapping)
 * falls back to the bare position (see {@link describePosition}). Never
 * guess a line: only add lines verified against the official form.
 *
 * Adding a tax year: see docs/data-model.md, "EÜR-Positionen".
 */

import type { EuerPosition } from "./positions";

export interface EuerLine {
  /** Line number ("Zeile") in the Anlage EÜR of the year. */
  readonly line: number;
  /** Line text of the official form. */
  readonly label: string;
}

export type EuerLineMapping = Readonly<Partial<Record<EuerPosition, EuerLine>>>;

/**
 * Anlage EÜR 2025.
 *
 * Source: BMF-Schreiben vom 29.08.2025, GZ IV C 6 - S 2142/00023/010/001
 * (BStBl I 2025 S. 1652), "Standardisierte Einnahmenüberschussrechnung nach
 * § 60 Absatz 4 EStDV; Anlage EÜR 2025", with the attached form
 * (Vordruck 2025AnlEÜR801–803, "- August 2025 -") and "Anleitung zur Anlage
 * EÜR - August 2025 - Version 1.9.1.1". Published by the BMF
 * (www.bundesfinanzministerium.de, BMF-Schreiben/Einkommensteuer); copy used:
 * https://www.steuerschroeder.de/blog/wp-content/uploads/2025/09/2025-08-29-anlage-EUER-2025.pdf
 */
const ANLAGE_EUER_2025: EuerLineMapping = {
  BETRIEBSEINNAHMEN_KLEINUNTERNEHMER: {
    line: 12,
    label: "Betriebseinnahmen als umsatzsteuerlicher Kleinunternehmer (nach § 19 Abs. 1 UStG)",
  },
  BETRIEBSEINNAHMEN_UST_PFLICHTIG: {
    line: 15,
    label:
      "Umsatzsteuerpflichtige Betriebseinnahmen (ohne solche zum ermäßigten Steuersatz von 0 %)",
  },
  BETRIEBSEINNAHMEN_UST_FREI: {
    line: 16,
    label:
      "Betriebseinnahmen, die umsatzsteuerfrei (§ 4 UStG) oder nicht umsatzsteuerbar sind oder " +
      "nach § 12 Abs. 3 UStG dem ermäßigten Steuersatz von 0 % unterliegen oder für die der " +
      "Leistungsempfänger die Umsatzsteuer nach § 13b UStG schuldet",
  },
  UST_VEREINNAHMT: {
    line: 17,
    label: "Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben",
  },
  UST_ERSTATTUNG: {
    line: 18,
    label: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer",
  },
  WAREN: {
    line: 27,
    label: "Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten",
  },
  FREMDLEISTUNGEN: { line: 29, label: "Bezogene Fremdleistungen" },
  GWG: {
    line: 36,
    label: "Aufwendungen für geringwertige Wirtschaftsgüter nach § 6 Abs. 2 EStG",
  },
  MIETE_GESCHAEFTSRAEUME: {
    line: 39,
    label: "Miete/Pacht für Geschäftsräume und betrieblich genutzte Grundstücke",
  },
  TELEKOMMUNIKATION: {
    line: 43,
    label: "Aufwendungen für Telekommunikation (z. B. Telefon, Internet)",
  },
  REISENEBENKOSTEN: {
    line: 44,
    label: "Übernachtungs- und Reisenebenkosten bei Geschäftsreisen des Steuerpflichtigen",
  },
  FORTBILDUNG: { line: 45, label: "Fortbildungskosten (ohne Reisekosten)" },
  RECHTS_STEUERBERATUNG: {
    line: 46,
    label: "Kosten für Rechts- und Steuerberatung, Buchführung",
  },
  MIETE_LEASING_BEWEGLICH: {
    line: 47,
    label: "Miete/Leasing für bewegliche Wirtschaftsgüter (ohne Kfz)",
  },
  BEITRAEGE_VERSICHERUNGEN: {
    line: 49,
    label: "Beiträge, Gebühren, Abgaben und Versicherungen (ohne solche für Gebäude und Kfz)",
  },
  EDV_KOSTEN: {
    line: 50,
    label: "Laufende EDV-Kosten (z. B. Beratung, Wartung, Reparatur)",
  },
  ARBEITSMITTEL: {
    line: 51,
    label: "Arbeitsmittel (z. B. Bürobedarf, Porto, Fachliteratur)",
  },
  WERBUNG: {
    line: 54,
    label: "Werbekosten (z. B. Inserate, Werbespots, Plakate)",
  },
  VORSTEUER: {
    line: 57,
    label: "Gezahlte und nach § 15 UStG abziehbare Vorsteuerbeträge",
  },
  UST_AN_FA: {
    line: 58,
    label: "An das Finanzamt gezahlte und ggf. verrechnete Umsatzsteuer",
  },
  SONSTIGE_AUSGABEN: {
    line: 60,
    label: "Übrige unbeschränkt abziehbare Betriebsausgaben",
  },
  BEWIRTUNG: { line: 63, label: "Bewirtungsaufwendungen" },
  VERPFLEGUNGSMEHRAUFWAND: { line: 64, label: "Verpflegungsmehraufwendungen" },
  FAHRTKOSTEN: {
    line: 70,
    label:
      "Sonstige tatsächliche Fahrtkosten ohne AfA und Zinsen (z. B. Reparaturen, Wartungen, " +
      "Treibstoff, Kosten für Flugstrecken, Kosten für öffentliche Verkehrsmittel)",
  },
  FAHRTKOSTEN_PRIVATFAHRZEUG: {
    line: 71,
    label: "Fahrtkosten für nicht zum Betriebsvermögen gehörende Fahrzeuge (Nutzungseinlage)",
  },
};

/**
 * Mapping per tax year. 2026 is provisionally the same as 2025 (#13) – it
 * still has to be checked against the Anlage EÜR 2026.
 */
export const EUER_LINE_MAPPINGS: Readonly<Record<number, EuerLineMapping>> = {
  2025: ANLAGE_EUER_2025,
  2026: ANLAGE_EUER_2025,
};

/** Whether a line mapping exists for the year (EÜR view hint, #26). */
export function hasLineMapping(year: number): boolean {
  return Object.hasOwn(EUER_LINE_MAPPINGS, year);
}

/**
 * A position with its line and official label in `year`. Without a mapping
 * for the year or the position, only the position is returned (#13); the UI
 * then shows the position's display name.
 */
export type PositionDescription =
  | { readonly position: EuerPosition; readonly line: number; readonly label: string }
  | { readonly position: EuerPosition; readonly line?: undefined; readonly label?: undefined };

export function describePosition(position: EuerPosition, year: number): PositionDescription {
  const entry = hasLineMapping(year) ? EUER_LINE_MAPPINGS[year]?.[position] : undefined;
  return entry ? { position, line: entry.line, label: entry.label } : { position };
}
