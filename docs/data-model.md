# Datenmodell

SQLite, beschrieben als Drizzle-Schema in
[`src/persistence/schema.ts`](../src/persistence/schema.ts). Das Schema ist die
Quelle der Wahrheit; die SQL-Migrationen erzeugt `drizzle-kit` daraus.

## Tabellen

| Tabelle      | Spalten                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookings`   | `id`, `date`, `type`, `gross_cents`, `vat_rate`, `net_cents`, `vat_cents`, `category_id` → `categories`, `description`, `counterparty`, `reference`, `note`, `source`, `external_id`, `created_at`, `updated_at` |
| `categories` | `id`, `name`, `type`, `euer_position`, `reduces_income`, `archived`, `is_system`                                                                                                                                 |
| `tax_years`  | `year` (PK), `small_business`                                                                                                                                                                                    |
| `settings`   | `key` (PK), `value` – Stripe (#28): `stripe.apiKey`, `stripe.defaultVatRate`, `stripe.feeCategoryId`, `stripe.refundCategoryId`, Import (#30): `stripe.lastImportAt`, `stripe.lastImportTo`                      |

Indizes: `bookings_date_idx` (`date`), `bookings_category_id_idx`
(`category_id`), `bookings_source_external_id_unique` (eindeutig auf
`source, external_id` **wo `external_id IS NOT NULL`**),
`categories_type_name_unique` (`type, name`).

## Entscheidungen

| Thema             | Entscheidung                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDs               | `INTEGER PRIMARY KEY AUTOINCREMENT`. Einfach, sortierbar, klein. UUIDs bringen nichts: Es gibt keine verteilte Erzeugung, und Stripe-Duplikate erkennt `external_id`. `AUTOINCREMENT` verhindert, dass IDs gelöschter Zeilen wiederverwendet werden.                                                                                                                                     |
| Datum             | `TEXT` als ISO-Kalenderdatum `YYYY-MM-DD` (wie `formatDate` erwartet), ohne Zeit/Zeitzone. Sortiert lexikografisch korrekt; das EÜR-Jahr ist `substr(date, 1, 4)` bzw. ein Bereichsvergleich. CHECK `date(date) IS date` weist Formatfehler und nicht existierende Tage (`2025-02-30`) zurück.                                                                                           |
| Zeitstempel       | `created_at`/`updated_at` als `TEXT` im Format von `Date#toISOString()` (UTC, `2025-03-07T12:34:56.789Z`). Kein DB-Default: Die Repositories (#11) setzen beide Werte, damit Tests eine feste Uhr nutzen können.                                                                                                                                                                         |
| Beträge           | `INTEGER` in Cent. `gross_cents > 0` (Beträge immer positiv, #1), `net_cents`/`vat_cents >= 0` und `net_cents + vat_cents = gross_cents`; alle drei mit CHECK `typeof(x) = 'integer'`. Netto/USt berechnet Business; die DB sichert nur die Konsistenz.                                                                                                                                  |
| USt-Satz          | `TEXT`: `'0'`, `'7'`, `'19'`, `'reverse_charge'` oder `NULL` (kein Satz erfasst, Kleinunternehmer). Text statt Zahl, damit Reverse Charge kein Sonderwert ist und `0 %` eindeutig von „kein Satz“ unterscheidbar bleibt. USt (`vat_cents > 0`) gibt es nur bei `'7'` und `'19'`; der CHECK nutzt `coalesce(vat_rate, '')`, weil `NULL IN (…)` NULL ergibt und den CHECK passieren ließe. |
| Enums             | `TEXT` mit CHECK (`type`: `income`/`expense`, `source`: `manual`/`stripe`). Die erlaubten Werte stehen als Konstanten im Schema; Business hat eigene Domänentypen (#11), die Repositories bilden ab.                                                                                                                                                                                     |
| Booleans          | `INTEGER` 0/1 (Drizzle `mode: "boolean"`), `NOT NULL DEFAULT false`, CHECK `IN (0, 1)`.                                                                                                                                                                                                                                                                                                  |
| Pflichtfelder     | `description` und `counterparty` sind `NOT NULL`; `reference`, `note`, `external_id`, `vat_rate` optional. Leere Strings verhindert Business, nicht die DB – Ausnahme `external_id`: `''` ist per CHECK verboten, weil es im Unique-Index wie eine echte ID kollidieren würde.                                                                                                           |
| Kategorie         | `category_id` `NOT NULL`, Fremdschlüssel mit `ON DELETE RESTRICT`: Kategorien mit Buchungen werden archiviert statt gelöscht. Dass Art der Buchung und der Kategorie übereinstimmen, prüft Business.                                                                                                                                                                                     |
| Kategorienamen    | Eindeutig pro Art (`type, name`), in der DB mit Groß-/Kleinschreibung (SQLite-`NOCASE` kennt keine Umlaute). Business (#14/#15) normalisiert Namen (trimmen) und vergleicht vor dem Speichern ohne Groß-/Kleinschreibung (`toLocaleLowerCase("de")`, inkl. Umlaute). „Mindert Einnahmen“ nur bei Ausgabe-Kategorien (CHECK), da Rückerstattungen Ausgaben sind (#1).                     |
| EÜR-Position      | `euer_position` ist ein stabiler Schlüssel (`TEXT`, z. B. `BETRIEBSEINNAHMEN_UST_PFLICHTIG`) ohne CHECK – die Liste der Positionen lebt im Code ([EÜR-Positionen](#eür-positionen-13)) und darf wachsen, ohne dass eine Migration nötig ist. Business prüft den Wert (`validateCategoryPosition`).                                                                                       |
| Steuerjahre       | `year` (`INTEGER`, 1000–9999) ist der Primärschlüssel.                                                                                                                                                                                                                                                                                                                                   |
| Duplikatschutz    | Partieller Unique-Index auf `(source, external_id) WHERE external_id IS NOT NULL`: Manuelle Buchungen ohne externe ID kollidieren nie; gelöschte Stripe-Buchungen können erneut importiert werden.                                                                                                                                                                                       |
| Spalten in CHECKs | Im Schema über `col(...)` unqualifiziert (`"date"` statt `"bookings"."date"`). Baut drizzle-kit eine Tabelle in einer späteren Migration als `__new_<tabelle>` neu auf, übernimmt es den Constraint-Text; ein Verweis auf `"bookings"` schlüge dort fehl.                                                                                                                                |

`STRICT`-Tabellen unterstützt drizzle-kit nicht; ohne die `typeof`-CHECKs
würde SQLite z. B. `1.5` in einer `INTEGER`-Spalte speichern. Text wie `'100'`
wandelt die Typ-Affinität der Spalte schon vor dem CHECK in die Zahl `100` um;
er wird daher als ganze Cent akzeptiert (siehe Test).

## EÜR-Positionen (#13)

Code in [`src/business/euer`](../src/business/euer) (rein, ohne DB – bis auf die Services, die über Unit of Work bzw. `FileSaver` laden und speichern):

| Datei                    | Inhalt                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `positions.ts`           | `EUER_POSITIONS` (stabile Schlüssel), `EUER_POSITION_DEFINITIONS` (Seite, zuweisbar, Kleinunternehmer-Ziel), `positionForTaxStatus` |
| `line-mapping.ts`        | `EUER_LINE_MAPPINGS` (Jahr → Position → Zeile + amtliche Bezeichnung), `describePosition(position, year)`, `hasLineMapping(year)`   |
| `category-position.ts`   | `validateCategoryPosition({ type, euerPosition, reducesIncome })` für den Kategorien-Service (#15)                                  |
| `calculate-euer.ts`      | `calculateEuer({ year, smallBusiness, groups, categories })` – die EÜR-Berechnung (#25), rein                                       |
| `euer-service.ts`        | `createEuerService({ unitOfWork })` mit `calculate(year)`: Status, Kategorien und Summen in einer Unit of Work                      |
| `report-order.ts`        | `incomeInReportOrder(result)`: Einnahmezeilen in Formularreihenfolge, Zeile 13 nach Zeile 12 (Ansicht #26, Export #27)              |
| `euer-csv.ts`            | `euerToCsv(result, labels)` – CSV der EÜR (#27, siehe docs/architecture.md)                                                         |
| `euer-export-service.ts` | `createEuerExportService({ euer, fileSaver })` mit `exportCsv(…)`: berechnen, Speicherdialog, schreiben                             |

- **Stabile Schlüssel.** Kategorien speichern nur den Schlüssel. Schlüssel
  werden nie umbenannt oder entfernt (sie stehen in der DB); neue Positionen
  sind einfach neue Schlüssel.
- **Zeilen pro Jahr.** `describePosition("TELEKOMMUNIKATION", 2025)` liefert
  `{ position, line: 43, label: "Aufwendungen für Telekommunikation (z. B. Telefon, Internet)" }`.
  Fehlt das Mapping für das Jahr oder die Position, kommt nur `{ position }`
  zurück; die UI zeigt dann den Anzeigenamen der Position.
- **Quelle 2025:** amtlicher Vordruck Anlage EÜR 2025 (2025AnlEÜR801–803,
  „August 2025“) und „Anleitung zur Anlage EÜR – August 2025 – Version
  1.9.1.1“, bekanntgegeben mit BMF-Schreiben vom 29.08.2025, GZ IV C 6 -
  S 2142/00023/010/001 (BStBl I 2025 S. 1652):
  <https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2025-08-29-anlage-EUER-2025.pdf?__blob=publicationFile&v=3>.
  Alle Zeilen im Mapping sind gegen den Vordruck geprüft.
- **Quelle 2026:** amtlicher Vordruck Anlage EÜR 2026 (2026AnlEÜR801–803,
  „August 2026“) und „Anleitung zur Anlage EÜR – August 2026 – Version
  2.5.1.1“, bekanntgegeben mit BMF-Schreiben vom 01.09.2026, GZ IV C 6 -
  S 2142/00024/010/001:
  <https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2026-09-01-anlage-EUER-2026.pdf?__blob=publicationFile&v=2>.
  Alle Zeilen geprüft. Gegenüber 2025 ist Zeile 27 („Bildung Rücklage
  Tierbewertung bei Land- und Forstwirten“) neu: Die Einnahmenzeilen 12–18
  bleiben, `WAREN` rückt von 27 auf 29, alle übrigen Ausgabenzeilen ab
  Fremdleistungen um eins nach hinten. Die Bezeichnungen sind in beiden
  Jahren gleich (`LABELS_2025_2026`).
- **Bezeichnungen** sind Formulardaten (wie Zeilennummern), keine UI-Texte:
  Sie stehen im Code statt in Paraglide. Reine Ausfüllhinweise im Vordruck
  (Verweise auf andere Zeilen, 10-Tage-Regel) sind weggelassen; Klammern,
  die den Inhalt beschreiben (Beispiele, „auch zurückgezahlte
  Hilfen/Zuschüsse aufgrund der Corona-Pandemie“), bleiben. Die **Anzeigenamen** der Positionen (z. B. im
  Kategorie-Formular, ohne Jahresbezug) sind UI-Texte:
  `euer_position_<schlüssel>` in `messages/de.json`, abgebildet in
  `src/ui/euer/position-name.ts` (`euerPositionName`).

### Positionen und Zeilen 2025/2026

| Position                                             | Seite    | Zeile 2025 | Zeile 2026 | Hinweis                                                             |
| ---------------------------------------------------- | -------- | ---------- | ---------- | ------------------------------------------------------------------- |
| `BETRIEBSEINNAHMEN_KLEINUNTERNEHMER`                 | Einnahme | 12         | 12         | nur berechnet, nicht zuweisbar (s. u.)                              |
| `BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR` | Einnahme | 13         | 13         | „davon“-Zeile, nur nachrichtlich (`informational`), nicht zuweisbar |
| `BETRIEBSEINNAHMEN_UST_PFLICHTIG`                    | Einnahme | 15         | 15         | netto                                                               |
| `BETRIEBSEINNAHMEN_UST_FREI`                         | Einnahme | 16         | 16         | steuerfrei, nicht steuerbar, 0 %, Reverse Charge (§ 13b UStG)       |
| `UST_VEREINNAHMT`                                    | Einnahme | 17         | 17         | berechnet aus dem USt-Anteil der Einnahmen, nicht zuweisbar         |
| `UST_ERSTATTUNG`                                     | Einnahme | 18         | 18         | Kategorie „USt-Erstattung“                                          |
| `WAREN`                                              | Ausgabe  | 27         | 29         |                                                                     |
| `FREMDLEISTUNGEN`                                    | Ausgabe  | 29         | 30         |                                                                     |
| `GWG`                                                | Ausgabe  | 36         | 37         |                                                                     |
| `MIETE_GESCHAEFTSRAEUME`                             | Ausgabe  | 39         | 40         |                                                                     |
| `TELEKOMMUNIKATION`                                  | Ausgabe  | 43         | 44         |                                                                     |
| `REISENEBENKOSTEN`                                   | Ausgabe  | 44         | 45         | Übernachtung, Reisenebenkosten                                      |
| `FORTBILDUNG`                                        | Ausgabe  | 45         | 46         |                                                                     |
| `RECHTS_STEUERBERATUNG`                              | Ausgabe  | 46         | 47         |                                                                     |
| `MIETE_LEASING_BEWEGLICH`                            | Ausgabe  | 47         | 48         |                                                                     |
| `BEITRAEGE_VERSICHERUNGEN`                           | Ausgabe  | 49         | 50         |                                                                     |
| `EDV_KOSTEN`                                         | Ausgabe  | 50         | 51         |                                                                     |
| `ARBEITSMITTEL`                                      | Ausgabe  | 51         | 52         | Bürobedarf, Porto, Fachliteratur                                    |
| `WERBUNG`                                            | Ausgabe  | 54         | 55         |                                                                     |
| `VORSTEUER`                                          | Ausgabe  | 57         | 58         | berechnet aus dem USt-Anteil der Ausgaben, nicht zuweisbar          |
| `UST_AN_FA`                                          | Ausgabe  | 58         | 59         | Kategorie „USt-Vorauszahlung“                                       |
| `SONSTIGE_AUSGABEN`                                  | Ausgabe  | 60         | 61         | übrige unbeschränkt abziehbare Betriebsausgaben                     |
| `BEWIRTUNG`                                          | Ausgabe  | 63         | 64         | Spalten „nicht abziehbar“/„abziehbar“ (s. u.)                       |
| `VERPFLEGUNGSMEHRAUFWAND`                            | Ausgabe  | 64         | 65         |                                                                     |
| `FAHRTKOSTEN`                                        | Ausgabe  | 70         | 71         | sonstige tatsächliche Fahrtkosten (z. B. Bahn, Flug, ÖPNV)          |
| `FAHRTKOSTEN_PRIVATFAHRZEUG`                         | Ausgabe  | 71         | 72         | Fahrzeug nicht im Betriebsvermögen (Nutzungseinlage)                |

### Kleinunternehmer

Kleinunternehmer tragen laut Anleitung 2025 (Zeile 12) ihre vollständigen
Betriebseinnahmen ohne die Beträge der Zeilen 18–22 in Zeile 12 ein; die
Zeilen 15–17 verwenden sie in der Regel nicht. Kategorien behalten deshalb
ihre Position (`BETRIEBSEINNAHMEN_UST_PFLICHTIG`/`_UST_FREI`), und die
EÜR-Berechnung (#25) bildet sie im Kleinunternehmer-Jahr mit
`positionForTaxStatus(position, smallBusiness)` auf
`BETRIEBSEINNAHMEN_KLEINUNTERNEHMER` ab. Ein Wechsel des Steuerstatus eines
Jahres braucht so keine Änderung an Kategorien. `UST_ERSTATTUNG` und alle
Ausgaben bleiben unverändert. `BETRIEBSEINNAHMEN_KLEINUNTERNEHMER`,
`BETRIEBSEINNAHMEN_KLEINUNTERNEHMER_NICHT_STEUERBAR`, `UST_VEREINNAHMT` und
`VORSTEUER` sind **nicht zuweisbar** – sie entstehen nur in der Berechnung.

Zeile 13 („davon nicht steuerbare Umsätze sowie Umsätze nach § 19 Abs. 2 …“)
ist eine nachrichtliche „davon“-Zeile: Ihr Betrag ist schon in Zeile 12
enthalten und zählt nicht zur Summe der Betriebseinnahmen
(`informational: true`).

Schuldet ein Kleinunternehmer als Leistungsempfänger die USt nach § 13b UStG
(z. B. für Werbeanzeigen oder Zahlungsgebühren ausländischer Anbieter), zahlt
er sie an das Finanzamt: Diese Zahlungen gehören zu `UST_AN_FA` (Kategorie
„USt-Vorauszahlung“); ein Vorsteuerabzug entfällt.

### Erlösminderung (`reduces_income`)

Eine Erlösminderungs-Kategorie ist eine **Ausgabe**-Kategorie, deren
`euer_position` die **Einnahmen**-Position ist, die sie mindert (Standard:
„Erlösminderung / Rückerstattung“ → `BETRIEBSEINNAHMEN_UST_PFLICHTIG`).
`validateCategoryPosition` liefert dafür Fehlercodes:

| Fall                                   | Erlaubte Position                                                                | Fehlercode sonst                           |
| -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| jede Kategorie                         | bekannt und zuweisbar                                                            | `unknownPosition`, `positionNotAssignable` |
| Einnahme-Kategorie                     | Einnahmen-Position                                                               | `positionKindMismatch`                     |
| Ausgabe-Kategorie                      | Ausgaben-Position                                                                | `positionKindMismatch`                     |
| Ausgabe-Kategorie mit `reducesIncome`  | Einnahmen-Position                                                               | `reducesIncomeNeedsIncomePosition`         |
| Ausgabe-Kategorie mit `reducesIncome`  | Umsatz-Position (15/16, mit Kleinunternehmer-Ziel), nicht z. B. `UST_ERSTATTUNG` | `reducesIncomeNeedsTurnoverPosition`       |
| Einnahme-Kategorie mit `reducesIncome` | –                                                                                | `reducesIncomeNotExpense` (DB: CHECK)      |

Die EÜR-Berechnung (#25) zieht die Beträge solcher Buchungen von ihrer
Position ab, statt sie als Ausgabe zu zählen (im Kleinunternehmer-Jahr nach
`positionForTaxStatus`, also von Zeile 12); der USt-Anteil einer
regelbesteuerten Rückerstattung mindert `UST_VEREINNAHMT` (Berichtigung der
geschuldeten USt), nicht `VORSTEUER` – siehe
[EÜR-Berechnung](#eür-berechnung-25).

### Standardkategorien (Migration `0001_default_categories`)

| Art      | Name                                               | Position                          | System |
| -------- | -------------------------------------------------- | --------------------------------- | ------ |
| Einnahme | Umsatzerlöse                                       | `BETRIEBSEINNAHMEN_UST_PFLICHTIG` |        |
| Einnahme | Steuerfreie / nicht steuerbare Erlöse              | `BETRIEBSEINNAHMEN_UST_FREI`      |        |
| Einnahme | USt-Erstattung                                     | `UST_ERSTATTUNG`                  | ja     |
| Ausgabe  | Fremdleistungen                                    | `FREMDLEISTUNGEN`                 |        |
| Ausgabe  | Geringwertige Wirtschaftsgüter (GWG)               | `GWG`                             |        |
| Ausgabe  | Miete Geschäftsräume                               | `MIETE_GESCHAEFTSRAEUME`          |        |
| Ausgabe  | Telefon / Internet                                 | `TELEKOMMUNIKATION`               |        |
| Ausgabe  | Übernachtung / Reisenebenkosten                    | `REISENEBENKOSTEN`                |        |
| Ausgabe  | Verpflegungsmehraufwand                            | `VERPFLEGUNGSMEHRAUFWAND`         |        |
| Ausgabe  | Fahrtkosten                                        | `FAHRTKOSTEN`                     |        |
| Ausgabe  | Fortbildung                                        | `FORTBILDUNG`                     |        |
| Ausgabe  | Rechts- und Steuerberatung, Buchführung            | `RECHTS_STEUERBERATUNG`           |        |
| Ausgabe  | Beiträge / Versicherungen                          | `BEITRAEGE_VERSICHERUNGEN`        |        |
| Ausgabe  | EDV-Kosten / Software                              | `EDV_KOSTEN`                      |        |
| Ausgabe  | Bürobedarf / Porto / Fachliteratur                 | `ARBEITSMITTEL`                   |        |
| Ausgabe  | Werbung                                            | `WERBUNG`                         |        |
| Ausgabe  | Bewirtung                                          | `BEWIRTUNG`                       |        |
| Ausgabe  | Bank- und Zahlungsgebühren                         | `SONSTIGE_AUSGABEN`               |        |
| Ausgabe  | Sonstige Betriebsausgaben                          | `SONSTIGE_AUSGABEN`               |        |
| Ausgabe  | USt-Vorauszahlung                                  | `UST_AN_FA`                       | ja     |
| Ausgabe  | Erlösminderung / Rückerstattung (`reduces_income`) | `BETRIEBSEINNAHMEN_UST_PFLICHTIG` | ja     |

- `is_system = 1` nur für die Kategorien, auf die sich die EÜR verlässt
  (USt an das bzw. vom Finanzamt, Erlösminderung). Der Kategorien-Service
  (#15) erlaubt bei ihnen nur das Umbenennen: nicht archivieren, nicht
  löschen, Position und „mindert Einnahmen“ fest
  ([Architektur](architecture.md#kategorien-service-15)). Die übrigen sind
  normale, änderbare Vorschläge.
- Die Migration läuft wie jede Migration genau einmal. Löscht oder benennt
  der Nutzer eine Standardkategorie um, kommt sie nicht wieder.
- Tests, die eine leere Kategorientabelle brauchen (z. B. der
  Repository-Vertrag), nutzen `createTestDb({ defaultCategories: false })`.
  `src/persistence/default-categories.test.ts` prüft die Seed-Daten und dass
  jede Position laut `validateCategoryPosition` gültig ist.

### Neues Steuerjahr ergänzen

1. Amtlichen Vordruck und Anleitung der Anlage EÜR des Jahres beschaffen
   (BMF-Schreiben „Standardisierte Einnahmenüberschussrechnung nach § 60
   Absatz 4 EStDV; Anlage EÜR <Jahr>“, bundesfinanzministerium.de).
2. In `line-mapping.ts` eine Konstante `ANLAGE_EUER_<JAHR>` anlegen (Quelle
   samt Datum, GZ und Version im Kommentar), jede Position gegen den Vordruck
   prüfen und in `EUER_LINE_MAPPINGS` eintragen (ein vorläufiges Jahr darf
   auf das Vorjahr zeigen). Nicht prüfbare Zeilen weglassen – dann greift
   der Fallback.
3. Die Zeilen des Jahres in `line-mapping.test.ts` festhalten.
4. Ändert sich die Fachlogik (z. B. eine Zeile wird geteilt), eine neue
   Position anlegen; alte Schlüssel bleiben.

## EÜR-Berechnung (#25)

`calculateEuer` (`src/business/euer/calculate-euer.ts`) ist eine reine
Funktion; `EuerService.calculate(year)` (`services.euer`) lädt in **einer**
Unit of Work den Steuerstatus (`TaxYearRepository.find`, ohne Datensatz
regelbesteuert), alle Kategorien (inkl. archivierter) und die Summen des
Jahres aus `BookingRepository.sumByCategoryAndVatRate(year)` – eine
Aggregat-Abfrage über den Datumsbereich des Jahres (Zahlungsdatum),
gruppiert nach Kategorie, Art und USt-Satz (Anzahl, Brutto, Netto, USt).
Ein ungültiges Jahr liefert ohne Datenbankzugriff
`{ ok: false, reason: "invalid", errors: [{ field: "year", code: "invalidYear" }] }`.

### Regeln

| Fall                                 | Regelbesteuert                                                             | Kleinunternehmer                            |
| ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------- |
| Betrag in der Position der Kategorie | Netto                                                                      | Brutto                                      |
| USt-Anteil (nur Satz `7`/`19`)       | Einnahme → `UST_VEREINNAHMT`, Ausgabe → `VORSTEUER`                        | keine USt-Positionen                        |
| Umsatz-Kategorie (Zeile 15/16)       | Satz `7`/`19` → 15, Satz `0`/`reverse_charge`/kein Satz → 16               | → `BETRIEBSEINNAHMEN_KLEINUNTERNEHMER` (12) |
| Zeile 13 (nachrichtlich)             | –                                                                          | Beträge der Kategorien mit `_UST_FREI`      |
| Erlösminderung (`reducesIncome`)     | Netto mindert 15 bzw. 16 (nach Satz), USt-Anteil mindert `UST_VEREINNAHMT` | Brutto mindert 12 (bei `_UST_FREI` auch 13) |
| `UST_ERSTATTUNG`, `UST_AN_FA`        | **Brutto** in Zeile 18 bzw. 58/59, nie USt-Zeilen (auch bei Satz 7/19)     | Brutto, unverändert                         |
| `BEWIRTUNG`                          | Netto, davon zählen 70 %; Vorsteuer voll                                   | Brutto, davon zählen 70 %                   |
| übrige Ausgaben                      | Netto in die Position                                                      | Brutto in die Position                      |

Entscheidungen (die früher offenen Punkte):

- **Status des Jahres, nicht der Satz der Buchung.** Im
  Kleinunternehmer-Jahr zählt immer der Bruttobetrag; ein gespeicherter Satz
  wird ignoriert (keine USt-Positionen, Satz `0` führt auch nicht zu Zeile
  13). Im regelbesteuerten Jahr zählt eine Buchung ohne Satz mit Netto =
  Brutto und USt 0 (so ist sie gespeichert); eine Einnahme ohne Satz geht wie
  Satz `0` nach Zeile 16. Unpassende Buchungen (#16) meldet das Ergebnis als
  Hinweis `vatRateInSmallBusinessYear` bzw. `vatRateMissingInRegularYear`
  mit Anzahl.
- **Zeile 15 oder 16 nach Satz.** Bei Umsatz-Kategorien (Positionen mit
  Kleinunternehmer-Ziel: `BETRIEBSEINNAHMEN_UST_PFLICHTIG`/`_UST_FREI`)
  entscheidet im regelbesteuerten Jahr der Satz der Buchung, und zwar in
  **beide** Richtungen: `0`, Reverse Charge oder kein Satz → 16, `7`/`19` →
  15 – auch eine Einnahme mit 19 % in „Steuerfreie / nicht steuerbare
  Erlöse“ ist steuerpflichtig, Zeile 16 wäre falsch. Erlösminderungen
  ebenso. `UST_ERSTATTUNG` bleibt in Zeile 18.
- **Zahlungen an das / Erstattungen vom Finanzamt** (`UST_AN_FA`,
  `UST_ERSTATTUNG`, in `EUER_POSITION_DEFINITIONS` als `taxOfficePayment`
  markiert, `isTaxOfficePayment`) enthalten keine USt: Laut Anleitung
  gehören die vollen gezahlten bzw. erstatteten Beträge in Zeile 18 bzw.
  58/59. Die Berechnung zählt deshalb immer den **Bruttobetrag** in der
  Position und nie einen USt-Anteil – auch wenn die Buchung (versehentlich,
  das Formular startet mit 19 %) Satz `7`/`19` hat; dann Hinweis
  `vatRateOnTaxPayment` mit Anzahl (nur regelbesteuert; im
  Kleinunternehmer-Jahr greift schon `vatRateInSmallBusinessYear`). Das
  Buchungsformular setzt bei Auswahl einer solchen Kategorie den Satz auf
  `0` und zeigt einen Hinweis; der Buchungs-Service prüft unverändert.
- **Kategorien nur über Position und Flag**, zum Berechnungszeitpunkt
  (Änderungen wirken rückwirkend, #15), nie über den Namen. Archivierte
  Kategorien zählen normal.
- **Erlösminderung:** Der USt-Anteil einer regelbesteuerten Rückerstattung
  mindert `UST_VEREINNAHMT` (Berichtigung der geschuldeten USt, § 17 UStG),
  nicht `VORSTEUER`.
- **Negative Zeilen** (Erlösminderung größer als die Einnahmen der Zeile)
  bleiben negativ und zählen so in die Summen; Hinweis `negativeLine` mit
  der Position. Typischer Fall: Rückerstattungen von Umsätzen eines
  Vorjahres übersteigen die Umsätze der Zeile in diesem Jahr (Zahlungsdatum
  entscheidet). Das ist zulässig – die Anlage EÜR nimmt negative Beträge
  (mit Minus) auf. Formulierung für #26 etwa: „Zeile X ist negativ, weil
  Erstattungen die Einnahmen dieser Zeile übersteigen (z. B. Rückzahlungen
  für Umsätze aus Vorjahren). Bitte Zuordnung prüfen.“
- **Zeile 13** (Kleinunternehmer) ergibt sich vor der Umleitung aus den
  Beträgen der Kategorien mit `BETRIEBSEINNAHMEN_UST_FREI` (inkl. deren
  Erlösminderungen); nur nachrichtlich (`informational`, nicht in der
  Summe, schon in Zeile 12 enthalten). Das ist eine Näherung: Zeile 16
  umfasst auch steuerfreie Umsätze nach § 4 UStG, die nicht unter § 19
  Abs. 2 Satz 1 Nr. 1 und 2 UStG fallen.
- **Bewirtung (Zeile 63, 2026: 64)** hat die Spalten „nicht abziehbar“ und
  „abziehbar“ (§ 4 Abs. 5 Satz 1 Nr. 2 EStG). Die Zeile trägt
  `entertainment: { totalCents, deductibleCents, nonDeductibleCents }`:
  30 % sind nicht abziehbar, **einmal** auf die Jahressumme kaufmännisch
  gerundet (`splitEntertainment`), der abziehbare Teil ist der Rest. Nur der
  abziehbare Teil ist der Betrag der Zeile (`amountCents`) und zählt in
  Ausgaben und Gewinn; der nicht abziehbare Teil steht nur in seiner Spalte.
  Die Vorsteuer auf Bewirtung zählt voll in `VORSTEUER` (die 70-%-Grenze
  gilt nur einkommensteuerlich). Hinweis `entertainmentSplit`. Grenzen: Die
  App prüft weder Angemessenheit noch Nachweis; voll abziehbare Bewirtung
  (z. B. reine Arbeitnehmerbewirtung) gehört in eine andere Kategorie.
- **Verpflegungsmehraufwand (Zeile 64, 2026: 65)** ist nur in Höhe der
  Pauschalen abziehbar. Die App kennt weder Reisetage noch Pauschalen und
  zählt die Beträge wie erfasst – Nutzer sollten die Pauschale als Betrag
  buchen. Hinweis `mealAllowanceFlatRates`.
- **§ 13b UStG als Leistungsempfänger:** Die an das Finanzamt gezahlte USt
  läuft über die Kategorie mit `UST_AN_FA` (Ausgabe). Die Eingangsleistung
  selbst hat Satz `reverse_charge` (Netto = Brutto, keine Vorsteuer). Im
  Kleinunternehmer-Jahr ist das korrekt (kein Vorsteuerabzug). Im
  regelbesteuerten Jahr verrechnet die Voranmeldung geschuldete USt und
  Vorsteuer aus § 13b; die App bildet beides nicht als eigene Beträge ab
  (Wirkung auf den Gewinn: null).
- **Nicht zuordenbare Buchungen** (Kategorie fehlt, Art der Kategorie passt
  nicht zur Buchung, Position unbekannt oder laut
  `validateCategoryPosition` ungültig – z. B. ein Schlüssel einer neueren
  App-Version) zählen **nicht**; Hinweis `unassignableBookings` mit Anzahl
  und Kategorie-IDs. Über die Services entstehen solche Daten nicht.

### Beträge

- Integer-Cent. Summiert werden die **gespeicherten** Netto- und
  USt-Beträge je Buchung (`sum(net_cents)`, `sum(vat_cents)`), nie aus
  Bruttosummen neu berechnet: Dreimal 0,10 € zu 19 % sind 0,24 € netto und
  0,06 € USt, nicht 0,25 € und 0,05 €. `MAX_AMOUNT_CENTS` hält alle Summen
  exakt.
- Gewinn = Einnahmen − Ausgaben (ohne nachrichtliche Zeilen); negativ =
  Verlust.

### Ergebnis (`EuerResult`)

```ts
{
  year, smallBusiness,
  hasLineMapping,                  // false → UI zeigt Positionsnamen (#26)
  income: EuerReportLine[],        // nach Zeile; ohne Mapping in Positionsreihenfolge
  expenses: EuerReportLine[],
  informational: EuerReportLine[], // Zeile 13, nicht in den Summen
  totals: { incomeCents, expenseCents, profitCents },
  warnings: EuerWarning[],         // Codes in fester Reihenfolge (s. EuerWarning)
}
EuerReportLine = {
  position, line?, label?,         // line/label nur mit Mapping (describePosition)
  amountCents,                     // zählt so in die Summe (Bewirtung: abziehbarer Teil)
  bookingCount,
  entertainment?,                  // nur BEWIRTUNG
  contributions: { categoryId, bookingType, vatRates, bookingCount, amountCents }[],
}
```

- **Welche Zeilen:** jede Position, zu der mindestens eine Buchung beiträgt
  – auch mit Summe 0 (z. B. Umsatz und volle Erstattung). Positionen ohne
  Buchungen fehlen. USt-Zeilen entstehen aus Buchungen mit Satz `7`/`19`.
- **Drill-down (#26):** `contributions` nennt je Kategorie und Buchungsart
  die beitragenden USt-Sätze, die Anzahl und den (vorzeichenbehafteten)
  Betrag; die Beiträge ergeben die Summe der Zeile (Bewirtung:
  `entertainment.totalCents`). Die Buchungen einer Zeile sind genau: Jahr +
  `categoryId` + `bookingType` + `vatRates` je Beitrag. Die Buchungssuche
  filtert dafür seit #26 auch nach USt-Satz (`vatRates`, URL `vat`); die
  Ansicht verlinkt die Vereinigung aus Kategorien und Sätzen – warum das
  genau ist: [Architektur](architecture.md#eür-jahresansicht-26).

## Migrationen

```
src/persistence/migrations/
  0000_init.sql            ← SQL, Anweisungen getrennt durch "--> statement-breakpoint"
  meta/_journal.json       ← Reihenfolge: entries[].idx / .tag (= Dateiname ohne .sql) / .when
  meta/0000_snapshot.json  ← Schema-Stand für den nächsten Diff (nur drizzle-kit)
```

- Schema ändern → `pnpm db:generate` (optional `--name <name>`) → erzeugte
  Dateien committen. Migrationen werden nie nachträglich geändert.
- Reine Datenmigrationen (z. B. Standardkategorien, #13) entstehen mit
  `pnpm db:generate --custom --name <name>`: drizzle-kit legt eine leere
  SQL-Datei samt Journal-Eintrag an, die man selbst füllt.
- CI prüft, dass Schema und Migrationen zusammenpassen: Nach
  `pnpm db:generate` darf sich nichts ändern.
- Die Dateien sind generiert und von oxfmt ausgenommen.

## Datenbank zur Laufzeit (#10)

| Datei                                            | Aufgabe                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                           | Pool mit genau einer Verbindung, beim Plugin registriert          |
| `src/persistence/tauri-sql-client.ts`            | `SqlClient` über `tauri-plugin-sql` (`Database.get`)              |
| `src/persistence/connection.ts`                  | `SqlConnection`: serialisiert Zugriffe, `exclusive`/`transaction` |
| `src/persistence/drizzle-proxy.ts`               | Callback für Drizzles `sqlite-proxy`                              |
| `src/persistence/database.ts`                    | `Database` = `{ db, transaction }`, Basis der Repositories        |
| `src/persistence/bundled-migrations.ts`          | Migrationen, von Vite gebündelt                                   |
| `src/persistence/migrator.ts`                    | eigener Migrator                                                  |
| `src/persistence/open-database.ts`               | `openDatabase(client)`: migrieren, `Database` erzeugen            |
| `src/app/startup.ts`, `src/app/app-services.tsx` | Start, Lade-/Fehlerbildschirm, Services per Context               |

### Datei und Verbindung

- **Ort:** `%APPDATA%\de.belegwerk.desktop\belegwerk.db` (Tauri `app_data_dir`
  des Identifiers; unter Windows identisch mit `app_config_dir`, das das
  Plugin selbst verwendet). Name im Plugin: `sqlite:belegwerk.db`.
  Debug-Builds (`pnpm tauri dev`) öffnen unter demselben Plugin-Namen die
  Datei `belegwerk-dev.db` (`DB_FILE` in `src-tauri/src/lib.rs`), damit
  Entwicklung und Tests die echten Daten nie berühren.
- **Genau eine Verbindung.** `tauri-plugin-sql` öffnet über `Database.load`
  einen sqlx-Pool mit bis zu zehn Verbindungen; einzelne `execute`-Aufrufe für
  `PRAGMA`, `BEGIN`, Statements und `COMMIT` landeten dann auf verschiedenen
  Verbindungen. Deshalb öffnet der Rust-Host die Datenbank selbst
  (`SqlitePoolOptions` mit `max_connections(1)` und ohne Idle-/Lifetime-Ablauf,
  damit eine offene Transaktion nicht mit der Verbindung verschwindet) und legt
  den Pool in die `DbInstances` des Plugins. Das Frontend nutzt `Database.get`
  (kein `load`); die Capability enthält nur `sql:allow-execute` und
  `sql:allow-select` – `load` (ersetzte den Pool) und `close` sind nicht
  erlaubt. Das ist reine Plugin-Konfiguration, keine Logik in Rust.
- **Im JS serialisiert:** Eine Verbindung genügt nicht, wenn zwei async-Flows
  sich abwechseln. `SqlConnection` reiht alle Aufrufe ein; `exclusive(fn)` gibt
  einem Flow die Verbindung für eine ganze Folge, `transaction(fn)` darauf
  aufbauend `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`.
- **Fremdschlüssel:** sqlx setzt `PRAGMA foreign_keys = ON` beim Öffnen jeder
  Verbindung (Default, im Host zusätzlich explizit); der Migrator schaltet es
  am Ende wieder ein.
- **Journal-Modus:** nicht gesetzt, also SQLite-Default `DELETE` (eine Datei,
  kein `-wal`) – einfach für Backups (M7, [#32](#backup-und-wiederherstellung-32)).
- **WebView-Reload:** Die Verbindung lebt im Host weiter. `openDatabase` rollt
  deshalb eine evtl. offen gebliebene Transaktion zurück.

Geprüft in der laufenden App (#10): Eine `TEMP`-Tabelle ist nur auf der
Verbindung sichtbar, die sie angelegt hat. 40 parallele Abfragen darauf
gelingen mit dem eigenen Pool alle; mit einem per `load` geöffneten
Standard-Pool schlugen 28 von 40 fehl (`no such table`). Ebenso bleibt
`PRAGMA foreign_keys = OFF` über Aufrufe hinweg erhalten.

### Backup und Wiederherstellung (#32)

**Backup:** Einstellungen → Datensicherung → „Backup erstellen“ schreibt per
`VACUUM INTO` eine konsistente Kopie der ganzen Datenbank (eine
SQLite-Datei, Vorschlag `belegwerk-backup-YYYY-MM-DD_HHMM.db`) und prüft sie
([Architektur](architecture.md#datensicherung-32)). Das Backup enthält alle
Daten einschließlich des Stripe-Schlüssels (Klartext).

**Backups nie im Datenordner der App speichern**
(`%APPDATA%\de.belegwerk.desktop` und darunter): Die App lehnt ein solches
Ziel vor jedem Schreibzugriff ab („Das Backup kann nicht im Datenordner der
App gespeichert werden …“), weil das Überschreiben von `belegwerk.db` oder
ihrem Journal die laufende Datenbank zerstören würde. Der Ordner würde zudem
beim Deinstallieren oder Zurücksetzen mit gelöscht. Nicht erkannt werden
Umwege über symbolische Links, Junctions, Hardlinks, zugeordnete Laufwerke,
UNC-Pfade auf den eigenen Rechner (`\\localhost\C$\…`, `\\<rechnername>\…`)
oder 8.3-Kurznamen des Ordners
([Architektur](architecture.md#datensicherung-32)).

**Wiederherstellen (manuell)** (für Nutzer: [README](../README.md#datensicherung)):

1. Belegwerk schließen (das Fenster schließen; es darf kein Prozess
   `belegwerk.exe` mehr laufen, sonst ist die Datei gesperrt).
2. Den Ordner `%APPDATA%\de.belegwerk.desktop` öffnen (Explorer-Adresszeile).
3. Die vorhandene `belegwerk.db` zur Sicherheit umbenennen oder wegkopieren,
   z. B. in `belegwerk-vorher.db`.
4. Die Backup-Datei in diesen Ordner kopieren und in `belegwerk.db`
   umbenennen.
5. Liegt dort eine `belegwerk.db-journal` (nur nach einem Absturz mitten in
   einem Schreibvorgang), gehört sie zur alten Datenbank: löschen bzw. mit
   verschieben – sonst würde SQLite sie auf das Backup anwenden. `-wal`/`-shm`
   gibt es nicht (Journal-Modus `DELETE`).
6. Belegwerk starten.

Verhalten beim Start:

- **Backup einer älteren App-Version:** Der Migrator wendet die fehlenden
  Migrationen an; danach ist die Datenbank auf dem Stand der App.
- **Backup einer neueren App-Version** (enthält Migrationen, die die App nicht
  kennt): Der Start bricht mit dem Fehlerbildschirm ab (`MigrationError`
  `unknown_migration`); die Datei bleibt unverändert. Dann die neuere
  App-Version installieren oder die alte `belegwerk.db` zurücklegen.
- **Keine gültige SQLite-Datei** (z. B. leer nach einem fehlgeschlagenen
  Backup): Eine leere Datei wird wie eine neue Datenbank behandelt (leere
  Datenbank mit Standardkategorien) – daher vor dem Ersetzen prüfen, dass die
  Backup-Datei nicht 0 Byte groß ist.

### Drizzle (`sqlite-proxy`)

`createProxyCallback` bildet Drizzles Methoden auf den Client ab: `run` →
`execute`, `all`/`values` → `select` mit Zeilen als Wert-Arrays, `get` → erste
Zeile oder `undefined`. Parameter: Booleans werden zu `1`/`0`, `undefined` zu
`NULL`; BigInt, Objekte und Bytes werden abgelehnt.

- **Eindeutige Spaltennamen.** Das Plugin liefert Zeilen als Objekte; Drizzle
  liest Werte nach Position. Doppelte Namen (z. B. `id` aus zwei Tabellen in
  einem Join) fielen zu einem Schlüssel zusammen – solche Spalten aliasieren
  (``sql<number>`${categories.id}`.as("category_id")``). Der Test-Client
  lehnt doppelte Namen ab, Persistence-Tests fallen also auf. Rein numerische
  Spaltennamen (JS sortiert sie nach vorn) lehnt der Adapter ab.
- **Zahlen** bindet das Plugin immer als `REAL` (wie `better-sqlite3`). In
  `INTEGER`-Spalten wandelt SQLite verlustfrei zurück; in einer `TEXT`-Spalte
  würde aus `2025` aber `'2025.0'` – Zahlen nicht an Text-Spalten binden.
- **Transaktionen nur über `Database.transaction(async (tx) => …)`.** Drizzles
  `db.transaction()` schickt `begin`/`commit` als einzelne Aufrufe, zwischen
  die andere Flows geraten könnten; der Adapter lehnt Transaktions-Statements
  deshalb ab. Im Callback nur `tx` verwenden – `db` wartet auf das Ende der
  Transaktion (Deadlock). Repositories kapseln das als `UnitOfWork`
  ([Architektur](architecture.md#transaktionen-nur-über-unitofworkrun)).
  Wartet ein Aufruf länger als 10 s auf die Verbindung, meldet
  `SqlConnection` das per `console.error` als Hinweis auf einen solchen
  Deadlock.
- **`db.batch([...])`** läuft atomar in einer Transaktion.
- **Fehler:** Drizzle verpackt Datenbankfehler in `DrizzleQueryError`
  („Failed query: …“); die SQLite-Meldung (z. B. `UNIQUE constraint failed`)
  steht in `cause` (ein `SqlError`).

### Laden im WebView

Der Migrator der App kann das Dateisystem nicht lesen (Drizzles eigener
`sqlite-proxy`-Migrator scheidet daher aus). Die Migrationen werden von Vite
gebündelt (`bundled-migrations.ts`):

```ts
import journal from "./migrations/meta/_journal.json";

const files = import.meta.glob<string>("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});
// Reihenfolge aus journal.entries; SQL = files[`./migrations/${entry.tag}.sql`],
// aufgeteilt an "--> statement-breakpoint".
```

Die Snapshots (`meta/*_snapshot.json`) braucht nur drizzle-kit; sie werden
nicht importiert und landen nicht im Bundle.

### Migrator

Tracking-Tabelle `__migrations`:

| Spalte       | Inhalt                                            |
| ------------ | ------------------------------------------------- |
| `idx`        | Position im Journal (PK)                          |
| `tag`        | Dateiname ohne `.sql`, eindeutig                  |
| `hash`       | SHA-256 des SQL (Zeilenenden auf LF normalisiert) |
| `applied_at` | Zeitpunkt der Anwendung (`toISOString()`)         |

Beim Start werden die angewendeten Migrationen geprüft; der Start bricht mit
`MigrationError` ab (Fehlerbildschirm), wenn

- `hash_mismatch`: eine angewendete Migration nachträglich geändert wurde
  (Migrationen werden nie geändert),
- `unknown_migration`: die DB eine Migration enthält, die die App nicht kennt
  (DB einer neueren Version),
- `order_mismatch`: die angewendeten nicht genau die ersten des Journals sind,
- `foreign_key_violation`: nach dem Migrieren Fremdschlüssel verletzt sind.

**Protokoll.** Ändert eine Migration eine Tabelle, die SQLite nicht per
`ALTER TABLE` ändern kann, baut drizzle-kit sie neu auf (`__new_<tabelle>`
anlegen, kopieren, alte löschen, umbenennen) und schreibt
`PRAGMA foreign_keys=OFF` davor. **Innerhalb einer Transaktion ignoriert
SQLite dieses Pragma** – bei einer Elterntabelle wie `categories` schlüge das
`DROP TABLE` fehl. Deshalb läuft alles in einem `exclusive`-Abschnitt der
Verbindung:

1. `PRAGMA foreign_keys = OFF` (außerhalb jeder Transaktion),
2. `BEGIN IMMEDIATE`, Tracking-Tabelle anlegen und prüfen, alle ausstehenden
   Migrationen ausführen und protokollieren,
3. `PRAGMA foreign_key_check` – liefert es Zeilen: `ROLLBACK` und Fehler,
4. `COMMIT` (bei jedem Fehler stattdessen `ROLLBACK`, auch für die
   Tracking-Tabelle),
5. `PRAGMA foreign_keys = ON` (auch nach einem Fehler; scheitert es dann
   selbst, wird der ursprüngliche Fehler gemeldet, nicht der des Pragmas).

### Hinweise für Repositories (#11 ff.)

- Repositories (`src/persistence/repositories/`) sind Fabriken über eine
  Drizzle-Instanz (`Db`): `database.db` für einzelne Abfragen oder `tx` in
  `Database.transaction`. `createAppServices` (`src/app/services.ts`)
  erzeugt sie; UI und Routen erhalten nur Business-Interfaces
  (`useAppServices()`). Details: [Architektur](architecture.md#repositories-und-unit-of-work-11).
- **Joins** nie als `select().from(a).innerJoin(b)` (doppelte Spaltennamen),
  sondern mit explizitem Select-Objekt und eindeutigen Aliassen.
- **`onConflictDoNothing` (Stripe-Import, #30):** Drizzle 0.45 erzeugt mit
  `onConflictDoNothing({ target, where })` für den partiellen Index
  ungültiges SQL. Stattdessen das nackte `.onConflictDoNothing()` verwenden
  (greift bei jedem Unique-Konflikt) oder vorhandene `external_id`s vorher
  abfragen.
- Tests nutzen `createTestDb()` aus
  [`src/persistence/__tests__/test-db.ts`](../src/persistence/__tests__/test-db.ts):
  `better-sqlite3` in-memory hinter demselben `openDatabase` wie die App
  (Migrator, Proxy-Adapter, `SqlConnection`) – nur das Plugin ist ersetzt.
