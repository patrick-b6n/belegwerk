/**
 * Stable EÜR positions (#13).
 *
 * Categories point to one of these keys (`categories.euer_position`), never to
 * a line number: the lines of the Anlage EÜR change from year to year, the
 * keys do not. Which line and official label a position has in a tax year is
 * defined in `line-mapping.ts`.
 *
 * Rules for the list:
 * - Keys are stored in the database – never rename or remove one. A new
 *   position is just a new key (no migration; the column has no CHECK).
 * - Only positions this app needs (single business, no AfA/fixed assets
 *   except GWG, #1). Add more when needed.
 */

import type { BookingType } from "../model";

export const EUER_POSITIONS = [
  // Betriebseinnahmen
  "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
  "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
  "BETRIEBSEINNAHMEN_UST_FREI",
  "UST_VEREINNAHMT",
  "UST_ERSTATTUNG",
  // Betriebsausgaben
  "WAREN",
  "FREMDLEISTUNGEN",
  "GWG",
  "MIETE_GESCHAEFTSRAEUME",
  "TELEKOMMUNIKATION",
  "REISENEBENKOSTEN",
  "FORTBILDUNG",
  "RECHTS_STEUERBERATUNG",
  "MIETE_LEASING_BEWEGLICH",
  "BEITRAEGE_VERSICHERUNGEN",
  "EDV_KOSTEN",
  "ARBEITSMITTEL",
  "WERBUNG",
  "VORSTEUER",
  "UST_AN_FA",
  "SONSTIGE_AUSGABEN",
  "BEWIRTUNG",
  "VERPFLEGUNGSMEHRAUFWAND",
  "FAHRTKOSTEN",
  "FAHRTKOSTEN_PRIVATFAHRZEUG",
] as const;

export type EuerPosition = (typeof EUER_POSITIONS)[number];

export interface EuerPositionDefinition {
  /** Side of the EÜR the position belongs to. */
  readonly kind: BookingType;
  /**
   * Whether a category may point to the position. `false` for positions the
   * EÜR calculation (#25) fills itself: the VAT shares (`UST_VEREINNAHMT`,
   * `VORSTEUER`) and the small-business income line.
   */
  readonly assignable: boolean;
  /**
   * In a small-business year (§ 19 UStG) the amounts of this position go to
   * this position instead (#25, see {@link positionForTaxStatus}).
   */
  readonly smallBusinessPosition?: EuerPosition;
}

const income = { kind: "income", assignable: true } as const;
const expense = { kind: "expense", assignable: true } as const;
/** Ordinary turnover: a small business reports it in one line (Anlage EÜR 2025, line 12). */
const turnover = {
  ...income,
  smallBusinessPosition: "BETRIEBSEINNAHMEN_KLEINUNTERNEHMER",
} as const;

export const EUER_POSITION_DEFINITIONS: Readonly<Record<EuerPosition, EuerPositionDefinition>> = {
  BETRIEBSEINNAHMEN_KLEINUNTERNEHMER: { kind: "income", assignable: false },
  BETRIEBSEINNAHMEN_UST_PFLICHTIG: turnover,
  BETRIEBSEINNAHMEN_UST_FREI: turnover,
  UST_VEREINNAHMT: { kind: "income", assignable: false },
  UST_ERSTATTUNG: income,
  WAREN: expense,
  FREMDLEISTUNGEN: expense,
  GWG: expense,
  MIETE_GESCHAEFTSRAEUME: expense,
  TELEKOMMUNIKATION: expense,
  REISENEBENKOSTEN: expense,
  FORTBILDUNG: expense,
  RECHTS_STEUERBERATUNG: expense,
  MIETE_LEASING_BEWEGLICH: expense,
  BEITRAEGE_VERSICHERUNGEN: expense,
  EDV_KOSTEN: expense,
  ARBEITSMITTEL: expense,
  WERBUNG: expense,
  VORSTEUER: { kind: "expense", assignable: false },
  UST_AN_FA: expense,
  SONSTIGE_AUSGABEN: expense,
  BEWIRTUNG: expense,
  VERPFLEGUNGSMEHRAUFWAND: expense,
  FAHRTKOSTEN: expense,
  FAHRTKOSTEN_PRIVATFAHRZEUG: expense,
};

const POSITION_SET: ReadonlySet<string> = new Set(EUER_POSITIONS);

export function isEuerPosition(value: string): value is EuerPosition {
  return POSITION_SET.has(value);
}

/**
 * The position a category's amounts are reported in for a year's tax status.
 * In a small-business year (Kleinunternehmer, § 19 UStG) all ordinary
 * turnover goes to `BETRIEBSEINNAHMEN_KLEINUNTERNEHMER`; everything else is
 * unchanged. Categories keep their position – the EÜR calculation (#25)
 * remaps per year, so switching a year's status needs no category changes.
 */
export function positionForTaxStatus(position: EuerPosition, smallBusiness: boolean): EuerPosition {
  return smallBusiness
    ? (EUER_POSITION_DEFINITIONS[position].smallBusinessPosition ?? position)
    : position;
}
