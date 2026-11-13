import type { EuerPosition } from "@/business/euer";
import { m } from "@/paraglide/messages.js";

/**
 * Display names of the EÜR positions (#13) – UI texts, so they go through
 * Paraglide. The official line labels of a tax year are form data and come
 * from `describePosition` (src/business/euer); show this name where a year
 * has no mapping or no year is in context (e.g. the category form, #15).
 */
const POSITION_NAMES: Readonly<Record<EuerPosition, () => string>> = {
  BETRIEBSEINNAHMEN_KLEINUNTERNEHMER: m.euer_position_betriebseinnahmen_kleinunternehmer,
  BETRIEBSEINNAHMEN_UST_PFLICHTIG: m.euer_position_betriebseinnahmen_ust_pflichtig,
  BETRIEBSEINNAHMEN_UST_FREI: m.euer_position_betriebseinnahmen_ust_frei,
  UST_VEREINNAHMT: m.euer_position_ust_vereinnahmt,
  UST_ERSTATTUNG: m.euer_position_ust_erstattung,
  WAREN: m.euer_position_waren,
  FREMDLEISTUNGEN: m.euer_position_fremdleistungen,
  GWG: m.euer_position_gwg,
  MIETE_GESCHAEFTSRAEUME: m.euer_position_miete_geschaeftsraeume,
  TELEKOMMUNIKATION: m.euer_position_telekommunikation,
  REISENEBENKOSTEN: m.euer_position_reisenebenkosten,
  FORTBILDUNG: m.euer_position_fortbildung,
  RECHTS_STEUERBERATUNG: m.euer_position_rechts_steuerberatung,
  MIETE_LEASING_BEWEGLICH: m.euer_position_miete_leasing_beweglich,
  BEITRAEGE_VERSICHERUNGEN: m.euer_position_beitraege_versicherungen,
  EDV_KOSTEN: m.euer_position_edv_kosten,
  ARBEITSMITTEL: m.euer_position_arbeitsmittel,
  WERBUNG: m.euer_position_werbung,
  VORSTEUER: m.euer_position_vorsteuer,
  UST_AN_FA: m.euer_position_ust_an_fa,
  SONSTIGE_AUSGABEN: m.euer_position_sonstige_ausgaben,
  BEWIRTUNG: m.euer_position_bewirtung,
  VERPFLEGUNGSMEHRAUFWAND: m.euer_position_verpflegungsmehraufwand,
  FAHRTKOSTEN: m.euer_position_fahrtkosten,
  FAHRTKOSTEN_PRIVATFAHRZEUG: m.euer_position_fahrtkosten_privatfahrzeug,
};

export function euerPositionName(position: EuerPosition): string {
  return POSITION_NAMES[position]();
}
