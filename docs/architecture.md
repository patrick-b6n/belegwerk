# Architektur

Tauri v2 ist nur Host; die gesamte Logik läuft in TypeScript im WebView. Der
Code unter `src/` ist in Layer gegliedert, deren Abhängigkeiten nur in eine
Richtung zeigen. Die Grenzen werden per **oxlint** (`no-restricted-imports`)
erzwungen, siehe [`.oxlintrc.json`](../.oxlintrc.json).

```
src/routes ─┬──────────────────► src/app ──────────────┐
src/ui ─────┤                   (Composition Root)     │ verdrahtet
            │                        │                 ▼
            └──► src/business ◄──────┴────────── src/persistence
```

Pfeile = „importiert aus“. `src/app` importiert aus allen Layern; UI und
Routen beziehen Services über `src/app`, nie direkt aus `src/persistence`.

## Ordner

| Ordner            | Inhalt                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes`      | TanStack-Router-Routen (dateibasiert). Dünn: lesen Parameter, rufen Services auf, rendern UI.                                     |
| `src/ui`          | Darstellung: Komponenten, Styles. `src/ui/components/ui` enthält die generierten shadcn/ui-Komponenten.                           |
| `src/business`    | Fachlogik: Berechnungen, Validierung, Services, Formatierung – und die **Repository-Interfaces (Ports)**. Kein React, kein Tauri. |
| `src/persistence` | Drizzle-Schema, Migrationen und die Implementierungen der Repository-Interfaces aus `src/business`.                               |
| `src/app`         | Composition Root: erzeugt DB, Repositories und Services und stellt sie der UI bereit (App-Start).                                 |

Generiert und von Lint/Format ausgenommen: `src/routeTree.gen.ts` (TanStack
Router) und `src/paraglide/` (Paraglide, git-ignoriert). Ebenfalls generiert,
aber eingecheckt und nur von oxfmt ausgenommen: `src/persistence/migrations/`
(drizzle-kit, siehe [Datenmodell](data-model.md)).

## Import-Regeln

| Layer                  | darf nicht importieren aus                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui`, `src/routes` | `src/persistence`, `drizzle-orm`, `drizzle-kit`, `better-sqlite3`, `@tauri-apps/plugin-sql`                                                                                                                                                                                         |
| `src/business`         | `src/persistence`, `src/ui`, `src/routes`, `src/app`, `src/router.tsx`, `src/routeTree.gen.ts`, `src/paraglide`, React-Paketen (`react`, `react-dom`, `@tanstack/react-*`, `@base-ui/react`, …), `@tauri-apps/*`, `drizzle-orm`, `drizzle-kit`, `better-sqlite3`; außerdem kein JSX |
| `src/persistence`      | `src/ui`, `src/routes`, `src/app`, `src/router.tsx`, `src/routeTree.gen.ts`, React-Paketen; außerhalb von Tests (`__tests__/`, `*.test.ts[x]`) zusätzlich `better-sqlite3`, `drizzle-kit`, `drizzle-orm/better-sqlite3` und `node:*` (läuft im WebView)                             |
| `src/app`              | – (darf alles)                                                                                                                                                                                                                                                                      |

Erfasst werden sowohl der Alias (`@/persistence/...`) als auch relative Pfade
(`../persistence/...`, `../../persistence`), jeweils für `import`,
`import type` und `export … from`.

**Bekannte Lücke (akzeptiert):** Die Regeln arbeiten auf dem Import-String,
nicht auf dem aufgelösten Pfad. Nicht normalisierte Pfade wie `./../persistence`
oder `@/ui/../persistence` werden nicht erkannt. Solche Pfade schreibt niemand
versehentlich; Reviews fangen sie ab.

### Kein JSX in `src/business`

Business enthält keine `.tsx`-Komponenten. oxlint meldet JSX in
`src/business` über `react/jsx-filename-extension` (keine Endung darf JSX
enthalten); React-Imports sind ohnehin verboten. Eine `.tsx`-Datei ohne JSX
wird nicht gemeldet – Business-Dateien sind trotzdem `.ts`.

### Keine UI-Texte in `src/business`

Business importiert nicht aus `src/paraglide`. Es gibt Codes zurück (z. B.
Fehlercodes von `parseAmount`); übersetzt wird in `src/ui` bzw. `src/routes`
(siehe [`docs/i18n.md`](i18n.md)).

### `src/app` stellt Services bereit

`src/app` gibt UI und Routen **Services** (bzw. Business-Interfaces) heraus und
re-exportiert nie Module aus `src/persistence` (Schema, Drizzle-Instanz,
Repository-Implementierungen). Sonst ließe sich die Regel „UI importiert nicht
aus Persistence“ über `@/app` umgehen; das kann Lint nicht erkennen.

### Repository-Interfaces liegen in `src/business`

Business arbeitet nur gegen Interfaces, darf aber **gar nicht** aus
`src/persistence` importieren – auch nicht `import type`. Stattdessen gilt
Dependency Inversion:

- Die Interfaces (z. B. `BookingRepository`, `CategoryRepository`) und die
  Domänentypen, die sie verwenden, liegen in `src/business` (#11).
- `src/persistence` importiert diese Interfaces/Typen aus `src/business` und
  implementiert sie mit Drizzle. Drizzle-Zeilentypen (`$inferSelect` o. Ä.)
  bleiben in `src/persistence` und werden dort auf Domänentypen abgebildet.
- `src/app` verdrahtet beides; Business-Tests nutzen In-Memory-Fakes der
  Interfaces.

So bleibt die Regel ein einfaches „Business importiert nichts aus
Persistence“, und Business hängt nicht vom DB-Schema ab.

UI und Routen dürfen außerdem weder `drizzle-orm`, `drizzle-kit`,
`better-sqlite3` noch `@tauri-apps/plugin-sql` importieren – Datenbankzugriff
gibt es nur in `src/persistence`.

## Repositories und Unit of Work (#11)

| Datei                                              | Inhalt                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/business/model.ts`                            | Domänentypen: `Booking`, `BookingInput`, `Category`, `CategoryInput`, `CategoryChanges`, `TaxYear`, Enums     |
| `src/business/repositories.ts`                     | Interfaces `BookingRepository`, `CategoryRepository`, `TaxYearRepository`, `SettingsRepository`, `UnitOfWork` |
| `src/persistence/repositories/`                    | Drizzle-Implementierungen, `createRepositories(db, clock)`, `createUnitOfWork(database, clock)`               |
| `src/business/__tests__/in-memory-repositories.ts` | In-Memory-Fakes für Business-Tests (`createInMemoryDatabase({ clock })`)                                      |
| `src/business/__tests__/repository-contract.ts`    | gemeinsame Vertragstests, laufen gegen Fakes **und** Drizzle (better-sqlite3)                                 |

- **Dünn:** Repositories lesen und schreiben, ohne Fachregeln. Pflichtfelder,
  Beträge, Kategorie-Art, archivierte Kategorien, Steuerstatus prüfen die
  Services (#14 ff.). Domänentypen statt Drizzle-Zeilen; Datum
  `YYYY-MM-DD`, Beträge in Cent, Zeitstempel als `toISOString()`.
- **Uhr:** `created_at`/`updated_at` setzt das Buchungs-Repository über eine
  injizierte `Clock` (`() => Date`); Tests geben eine feste Uhr vor.
- **Constraint-Verletzungen** (Unique-Index, Fremdschlüssel) kommen als
  `ConstraintViolationError` mit `kind: "unique" | "foreign_key"` aus
  `src/business`. Services prüfen vorher selbst (bessere Meldungen); der Fehler
  ist das Sicherheitsnetz. Erkannt wird die Art nur am Fehler der Datenbank
  (`SqlError` bzw. SQLite-Code), nicht an Drizzles äußerem Fehler – dessen
  Meldung enthält die gebundenen Parameter, also Nutzereingaben. Auch die
  Meldung des `ConstraintViolationError` enthält keine Parameter.
  CHECK-Verletzungen werden nicht übersetzt – sie bedeuten einen
  Validierungsfehler im Service (z. B. „mindert Einnahmen“ bei einer
  Einnahme-Kategorie).
- **Suche (#21):** `BookingRepository.search({ filter, sort, limit?, offset? })`
  liefert die passenden Buchungen sortiert (optional ein Fenster),
  `summarize(filter)` Anzahl und Bruttosummen je Art aller passenden
  Buchungen – Filtern, Sortieren, Blättern und Summieren per SQL. Details
  unter [Buchungssuche](#buchungssuche-21). Die EÜR (#25) liest
  `sumByCategoryAndVatRate(year)`: Summen je Kategorie, Art und USt-Satz in
  einer Aggregat-Abfrage.

### Transaktionen: nur über `UnitOfWork.run`

Zusammengehörige Schreibvorgänge laufen in `unitOfWork.run(async (repos) =>
…)`: `COMMIT`, wenn der Callback erfüllt, sonst `ROLLBACK` und der Fehler wird
weitergeworfen.

**Regel: Im Callback nur die übergebenen `repos` verwenden.** Die Datenbank
hat genau eine, serialisierte Verbindung ([Datenmodell](data-model.md)). Ein
Aufruf über die äußeren Repositories (oder ein verschachteltes `run`) reiht
sich hinter die laufende Transaktion ein – die aber erst endet, wenn der
Callback fertig ist: **Deadlock**, die App hängt. Daher:

- Services bekommen Repositories/Unit of Work injiziert und reichen innerhalb
  von `run` die `repos` des Callbacks weiter (z. B. an Hilfsfunktionen), statt
  auf eigene Felder zuzugreifen.
- Die In-Memory-Fakes werfen in diesem Fall sofort einen Fehler; Business-Tests
  fallen also auf.
- In der App meldet `SqlConnection` per `console.error`, wenn ein Aufruf
  länger als 10 s auf die Verbindung wartet (Hinweis auf diese Regel).

Die Persistence-Implementierungen sind deshalb Fabriken über einen
Drizzle-Parameter (`createBookingRepository(db, clock)`): `createUnitOfWork`
erzeugt sie für jede Transaktion neu auf deren `tx`.

### Vertragstests

`describeRepositoryContract(name, setup)` beschreibt das Verhalten aller
Implementierungen (IDs festgeschriebener Zeilen werden nie wiederverwendet,
eine in einer zurückgerollten Unit of Work vergebene schon; Rückgabewerte,
Constraint-Fehler, Rollback). Es läuft in `src/business/__tests__/in-memory-repositories.test.ts`
gegen die Fakes und in `src/persistence/repositories/repositories.test.ts`
gegen Drizzle auf `better-sqlite3` – so können die Fakes nicht vom echten
Verhalten abweichen, und jede Repository-Abfrage läuft durch den Test-Client,
der doppelte Ergebnis-Spaltennamen ablehnt. Neue Repository-Methoden bekommen
ihre Fälle im Vertrag. Von den CHECK-Constraints der DB bilden die Fakes nur
„mindert Einnahmen nur bei Ausgabe-Kategorien“ nach (einfacher `Error`); die
übrigen (Beträge, Datum, Enum-Werte) prüfen die Services.

**Joins:** kein `select().from(a).innerJoin(b)` – Spalten gleichen Namens
(`id`, `type`, …) fielen im Plugin zu einem Wert zusammen. Stattdessen ein
explizites Select-Objekt mit eindeutigen Namen
([Datenmodell](data-model.md#drizzle-sqlite-proxy)).

### Plattformzugriffe

Business ist frei von Tauri. Braucht Logik Plattformfunktionen (HTTP für
Stripe, Dateien für CSV), definiert Business ein Interface; die Implementierung
mit `@tauri-apps/*` liegt außerhalb von `src/business` und wird in `src/app`
verdrahtet. Ebenso sind `drizzle-orm`, `drizzle-kit` und `better-sqlite3` in
Business verboten – Drizzle gibt es nur in `src/persistence`.

**Dateien speichern (#24):** Port `FileSaver` (`src/business/files.ts`,
`saveTextFile({ defaultFileName, filter, content })` →
`{ saved: true, path }` oder `{ saved: false }` bei Abbruch; Schreibfehler
werfen). Implementierung `createTauriFileSaver()` in
`src/app/tauri-file-saver.ts`: Speicherdialog `save()` aus
`tauri-plugin-dialog`, dann `writeTextFile()` aus `tauri-plugin-fs` (UTF-8,
unverändert). `createAppServices(database, clock, fileSaver)` verdrahtet ihn;
Tests geben einen Fake.

- **Capabilities** (`src-tauri/capabilities/default.json`), so knapp wie
  möglich: `dialog:allow-save` und `fs:allow-write-text-file` – **ohne**
  konfigurierten fs-Scope. Der Dialog trägt den gewählten Pfad zur Laufzeit in
  den fs-Scope ein (`allow_file` in `tauri-plugin-dialog`); geschrieben werden
  kann also genau die Datei, die der Nutzer gewählt hat, kein anderer Pfad
  (auch nicht AppData). Kein `fs:default` (Lesezugriff auf App-Ordner) und
  nicht `fs:allow-write-file` (erlaubt zusätzlich `open`/`write`).
- Der eingetragene Pfad bleibt bis zum Programmende im Scope (Verhalten des
  Plugins). Bis dahin kann die WebView diese Datei erneut beschreiben – auch
  anhängen: `fs:allow-write-text-file` erlaubt die Option `append: true` von
  `writeTextFile`, eine Capability kann das nicht abschalten. Der Export nutzt
  sie nicht; er schreibt ohne Optionen (anlegen bzw. ersetzen, `truncate`), der
  Dialog fragt vor dem Überschreiben.
- Die Plugins sprechen nur über die IPC (`ipc:`/`http://ipc.localhost`) – die
  CSP braucht keine Erweiterung.

## Geld und USt (#12)

`src/business/money` rechnet aus Brutto und USt-Satz Netto und USt –
ausschließlich mit Integer-Cent und exakter Ganzzahlarithmetik (BigInt, keine
Gleitkommazahlen).

- **Rundung:** Die enthaltene USt ist `brutto × satz / (100 + satz)`,
  kaufmännisch gerundet (ab ½ Cent auf); Netto ist der Rest
  (`netto = brutto − ust`). So weisen Kassenbelege und Rechnungen die
  enthaltene USt aus, und `netto + ust = brutto` gilt per Konstruktion. Mit
  7 % und 19 % sind die Nenner 107 und 119 ungerade – ein Quotient endet nie
  auf genau ½ Cent, „USt zuerst“ und „Netto zuerst“ ergeben also immer dasselbe
  (in den Tests bewiesen).
- **`splitGross(grossCents, vatRate)`:** `'7'`/`'19'` mit USt; `'0'`,
  `'reverse_charge'` und `null` (kein Satz, Kleinunternehmer) mit USt 0 und
  Netto = Brutto. Ungültige Argumente (Brutto keine positive sichere Ganzzahl,
  unbekannter Satz) sind Programmierfehler → `RangeError`; „Betrag > 0“ prüft
  der Service vorher.
- **`calculateBookingAmounts(grossCents, vatRate, smallBusiness)`:** zusätzlich
  die Jahresregel (#14, #16) als Ergebnisobjekt: im Kleinunternehmer-Jahr ist
  ein Satz `"vatRateNotAllowed"`, im regelbesteuerten Jahr fehlt er als
  `"vatRateRequired"`. Bei `ok: true` passen `netCents`, `vatCents`, `vatRate`
  direkt in `BookingInput`.

## Buchungs-Service (#14)

`src/business/bookings` – `createBookingService({ unitOfWork })` mit
`list(query?)`, `get(id)`, `create(input)`, `update(id, input)`, `delete(id)`. Eingabe ist
`BookingFormInput` (was das Formular abschickt): Datum, Art, Brutto in Cent,
USt-Satz, Kategorie, Beschreibung, Gegenpartei, Referenz, Notiz, optional
Quelle und externe ID. Netto/USt nimmt der Service nie entgegen, er berechnet
sie (`calculateBookingAmounts`).

- **Eine Unit of Work pro Operation:** Kategorie, Steuerjahr und externe IDs
  werden in derselben Transaktion gelesen, in der geschrieben wird; eine
  fehlgeschlagene Validierung schreibt nichts.
- **Ergebnisobjekte statt Exceptions:** `{ ok: true, booking }`,
  `{ ok: false, reason: "invalid", errors }` oder
  `{ ok: false, reason: "notFound" }` (`get`, `update`, `delete`; auch bei
  ungültiger ID wie `NaN`, ohne Datenbankzugriff). `errors` enthält **alle**
  Feldfehler (höchstens einer pro Feld, in Formularreihenfolge) als
  `{ field, code }` – das Formular (#18) zeigt sie am Feld und übersetzt die
  Codes (`BookingFieldErrorCodes`). Programmierfehler werfen.
- **Regeln:** Datum existierendes `YYYY-MM-DD` mit Jahr 1000–9999
  (`parseIsoDate`, wie der DB-CHECK); Brutto Ganzzahl > 0 und höchstens
  `MAX_AMOUNT_CENTS`; USt-Satz bekannt und passend zum Steuerstatus des
  Jahres aus dem Datum (ohne Datensatz regelbesteuert); Kategorie gewählt
  (positive Ganzzahl, sonst `required` – z. B. `NaN` aus einem leeren
  Select), existiert und passt zur Art. **Archivierte Kategorien:** nicht für
  neue Buchungen und nicht als neue Kategorie beim Bearbeiten; eine Buchung
  darf ihre inzwischen archivierte Kategorie aber behalten (sonst ließe sie
  sich nach dem Archivieren nicht mehr bearbeiten).
- **Höchstbetrag** `MAX_AMOUNT_CENTS` (`src/business/money/limits.ts`):
  100.000.000,00 € pro Buchung, gemeinsam für `parseAmount` (`tooLarge`) und
  den Service (`amountTooLarge`). So bleiben Summen exakte JS-Zahlen:
  `Number.MAX_SAFE_INTEGER` fasst rund 900.000 Buchungen mit Höchstbetrag –
  Summen der Suche (#21) und der EÜR (#25) brauchen kein BigInt.
- **Texte** werden getrimmt (`trimText`), auch unsichtbare Formatzeichen
  (`\p{Cf}`, z. B. U+200B–U+200D, U+2060, U+00AD, U+FEFF) und Unicode-Leerzeichen
  (`\p{Z}`) am Rand; Innenleerraum, Zeilenumbrüche und innere Formatzeichen
  (z. B. ZWJ in Emojis) bleiben. Enthält ein Text kein sichtbares Zeichen, gilt
  er als leer;
  leere optionale Texte werden `null`. Beschreibung, Gegenpartei, Referenz
  und Notiz werden NFC-normalisiert gespeichert (die Suche #21 findet sie so
  auch bei zerlegter Eingabe), die externe ID bleibt unverändert. Höchstlängen nach dem Trimmen
  (`BOOKING_TEXT_MAX_LENGTH`): Beschreibung 500, Gegenpartei 200, Referenz
  200, Notiz 2000, externe ID 255 Zeichen.
- **Referenz und Notiz** sind Pflicht-Properties (`string | null`); `null`
  oder ein leerer String leert sie. Nur **Quelle und externe ID** dürfen
  fehlen (`undefined`): `create` setzt die Defaults (`"manual"`, `null`),
  `update` behält den aktuellen Wert – eine Stripe-Buchung bleibt also eine,
  auch wenn das Formular Quelle und externe ID nicht zeigt.
- **Quelle und externe ID** sind rein informativ. Nur der Unique-Index auf
  `(source, external_id)` wird vorab geprüft (`externalIdDuplicate`). Ein
  `ConstraintViolationError` beim Schreiben (Wettlauf) wird explizit
  abgebildet: `unique` → `externalIdDuplicate`, `foreign_key` →
  `categoryNotFound`; alles andere wird weitergeworfen.

- **`list(query?)`** (Buchungsliste #17, Suche #21) liefert eine Seite der
  passenden Buchungen, jeweils mit `category: { id, name, archived }`, dazu
  Gesamtanzahl und Summen – siehe [Buchungssuche](#buchungssuche-21).
  Kategorien kommen per `CategoryRepository.list()` in derselben Unit of
  Work und werden im Service verknüpft – kein N+1 und kein SQL-Join mit
  doppelten Spaltennamen.

### Buchungssuche (#21)

`BookingQuery` (`src/business/bookings/booking-query.ts`), alle Felder
optional und per UND verknüpft:

| Feld                     | Bedeutung                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `text`                   | Teilstring in Beschreibung, Gegenpartei, Referenz oder Notiz; ohne Groß-/Kleinschreibung, auch Umlaute |
| `dateFrom`, `dateTo`     | Zahlungsdatum `YYYY-MM-DD`, jeweils inklusive                                                          |
| `type`, `source`         | Art bzw. Quelle                                                                                        |
| `categoryIds`            | eine der Kategorien (leer = alle; Duplikate egal; höchstens 500)                                       |
| `amountFrom`, `amountTo` | **Brutto** in Cent, jeweils inklusive                                                                  |
| `sort`                   | `{ field, direction }`, Felder `BOOKING_SORT_FIELDS`; Standard Datum absteigend                        |
| `page`, `pageSize`       | Seite ab 1 (Standard 1); Größe 1–500 (Standard 50) oder `"all"`                                        |

Ergebnis von `BookingService.list(query)`: `{ ok: true, items, total, page,
pageSize, pageCount, sums: { incomeCents, expenseCents, balanceCents } }`
oder `{ ok: false, reason: "invalid", errors }`.

- **Validierung** (`normalizeBookingQuery`, auch einzeln nutzbar, z. B. für
  das URL-Schema #22): Fehler als Codes pro Feld (`BookingQueryErrorCodes`),
  nichts wird stillschweigend korrigiert – ungültige Daten (`invalidDate`),
  `dateTo` vor `dateFrom` (`dateRangeInverted`, kein Tauschen), Beträge keine
  Ganzzahl ≥ 0 (`invalidAmount`) oder `amountTo` < `amountFrom`
  (`amountRangeInverted`), unbekannte Sortierung (`invalidSort`), Seite bzw.
  Seitengröße ungültig. Ein ungültiges Query fragt die Datenbank nicht ab.
  Text wird getrimmt (`trimText`) und NFC-normalisiert, max. 200 Zeichen;
  Steuerzeichen (`\p{Cc}`, z. B. NUL – `GLOB` endete dort – oder
  Zeilenumbruch) und einzelne Surrogates werden abgelehnt (`invalidText`),
  nicht entfernt;
  leere Texte/Daten und leere `categoryIds` filtern nicht.
- **Seite hinter der letzten** → die letzte Seite; `page` im Ergebnis ist
  die tatsächlich gelieferte (z. B. nach dem Löschen der letzten Buchung
  einer Seite). Die UI (#23) kann ihre URL daran angleichen. `pageCount` ist
  mindestens 1 (leeres Ergebnis = eine leere Seite).
- **`pageSize: "all"`** liefert alle passenden Buchungen auf einer Seite –
  für den CSV-Export (#24), der denselben Filter und dieselbe Sortierung wie
  die Liste nutzt.
- **Summen** über **alle** passenden Buchungen (nicht nur die Seite), auf
  **Bruttobasis**: Einnahmen, Ausgaben, Saldo = Einnahmen − Ausgaben (wie ein
  Kontoauszug; die steuerliche Sicht mit Netto/USt und Erlösminderung ist
  die EÜR, #25). `MAX_AMOUNT_CENTS` hält sie exakt.
- **Sortierung:** Texte (Beschreibung, Gegenpartei, Kategoriename) mit
  SQLite `NOCASE` – Groß-/Kleinschreibung nur bei ASCII egal, sonst nach
  Codepunkt (Umlaute nach `z`; echte deutsche Kollation gibt es in SQLite
  ohne ICU nicht). `type`/`source` nach gespeichertem Wert. Gleichstand: bei
  `date` nach `id` in derselben Richtung, sonst Datum absteigend, dann `id`
  absteigend – eine totale Ordnung, stabil über Seiten hinweg.
- **Ablauf:** eine Unit of Work mit `summarize` (Anzahl + Summen, eine
  Aggregat-Abfrage), dann `search` mit `LIMIT/OFFSET` der (ggf. auf die
  letzte begrenzten) Seite, dann die Kategorien.
- **Groß-/Kleinschreibung im Freitext:** SQLite `LIKE`/`lower()` falten nur
  ASCII („müller“ fände „MÜLLER“ nicht), eigene SQL-Funktionen lassen sich
  über `tauri-plugin-sql` nicht registrieren, und eine abgeleitete
  Suchspalte bräuchte ein fragiles Backfill. Stattdessen wird jedes Zeichen
  des Suchtexts in JS zur Menge seiner Schreibvarianten
  (`textSearchCharClasses`: `toLowerCase`/`toUpperCase`, plus ß/ẞ), und die
  Datenbank vergleicht per `GLOB` zeichenweise gegen diese Menge:
  `"Mü"` → `*[Mm][üÜ]*`. Wildcards im Suchtext (`*`, `?`, `[`) stehen in
  eigenen Mengen und gelten wörtlich; `%` und `_` sind in `GLOB` ohnehin
  normale Zeichen. Grenzen: Abbildungen auf mehrere Zeichen fehlen (`ß`
  findet nicht `SS`), und Texte, die vor #21
  in zerlegter Form (NFD) gespeichert wurden, findet ein NFC-Suchtext nicht –
  seit #21 speichert der Service Beschreibung, Gegenpartei, Referenz und
  Notiz NFC-normalisiert. Der In-Memory-Fake baut aus denselben Mengen einen
  RegExp; der Vertragstest prüft beide gleich.

## Kategorien-Service (#15)

`src/business/categories` – `createCategoryService({ unitOfWork })` mit
`list()`, `get(id)`, `create(input)`, `update(id, changes)`, `archive(id)`,
`reactivate(id)`, `delete(id)`. Gleiche Konventionen wie der
Buchungs-Service: eine Unit of Work pro Operation, Ergebnisobjekte mit
Feldcodes (`CategoryFieldErrorCodes`), `notFound` auch bei ungültiger ID ohne
Datenbankzugriff, Texte getrimmt (`trimText`/`isId` aus
`src/business/validation.ts`, gemeinsam mit #14).

- **`list()`** liefert alle Kategorien inkl. archivierter (nach `id`), jeweils
  mit `bookingCount` (eine Abfrage: `BookingRepository.countByCategories()`
  mit `GROUP BY`) – die Verwaltung (#19) gruppiert nach Art und bietet
  „Löschen“ nur bei `bookingCount === 0` an; das Buchungsformular (#18)
  filtert nach Art und ohne archivierte.
- **`create({ name, type, euerPosition, reducesIncome })`** legt eine normale
  Kategorie an (`isSystem: false`, nicht archiviert). **`update(id, changes)`**
  ändert `name`, `euerPosition`, `reducesIncome`; fehlende Felder bleiben, die
  Art ist fest. Position und Flag werden nur geprüft, wenn sich eines davon
  ändert – Umbenennen scheitert nie an der Position. Archivierte Kategorien
  sind bearbeitbar.
- **Name:** getrimmt und NFC-normalisiert, Pflicht, höchstens
  `CATEGORY_NAME_MAX_LENGTH` (100) Zeichen, eindeutig pro Art ohne
  Groß-/Kleinschreibung (`toLocaleLowerCase("de")`, „Büro“ = „BÜRO“, auch mit
  kombinierendem Umlaut) – auch gegenüber archivierten Kategorien, da der
  Unique-Key der DB sie einschließt. Codes: `required`, `tooLong`,
  `nameDuplicate`.
- **Position/Flag:** `validateCategoryPosition`, Codes auf Felder verteilt:
  `euerPosition` bekommt `required` (leer), `unknownPosition`,
  `positionNotAssignable`, `positionKindMismatch`,
  `reducesIncomeNeedsIncomePosition`, `reducesIncomeNeedsTurnoverPosition`;
  `reducesIncome` bekommt `invalidValue` (kein Boolean – zur Laufzeit geprüft
  wie `type`; die Position wird dann ohne Flag geprüft) oder
  `reducesIncomeNotExpense` (Einnahme-Kategorie; die Position wird dann wie
  bei einer normalen Einnahme-Kategorie geprüft). Bei
  ungültiger Art (`type: invalidType`) nur die artunabhängigen Prüfungen.
- **Position ändern wirkt rückwirkend:** Buchungen speichern nur die
  Kategorie; die EÜR (#25) nimmt Position und Flag der Kategorie zum
  Berechnungszeitpunkt. Keine Buchung wird umgeschrieben.
- **Systemkategorien** (`isSystem`: USt-Vorauszahlung, USt-Erstattung,
  Erlösminderung / Rückerstattung): umbenennbar, aber nicht archivierbar oder
  löschbar (`{ ok: false, reason: "systemCategory" }`); Position und Flag
  sind fest (`systemCategoryFixed` am jeweiligen Feld, nur wenn sich der Wert
  ändert). Reaktivieren ist immer erlaubt. Vertrag für #25: Die EÜR erkennt
  diese Kategorien an Position und Flag, **nie am Namen**.
- **Archivieren/Reaktivieren** ist idempotent; archivierte Kategorien bleiben
  für ihre Buchungen gültig (siehe Buchungs-Service). Ein Namenskonflikt beim
  Reaktivieren ist unmöglich (der Unique-Key umfasst archivierte).
- **Löschen** nur ohne Buchungen: Die Anzahl wird in derselben Unit of Work
  geprüft, sonst `{ ok: false, reason: "inUse", bookingCount }` (Hinweis:
  archivieren). Ein `foreign_key`-`ConstraintViolationError` (Wettlauf) wird
  ebenso zu `inUse` (`bookingCount` mindestens 1); `unique` beim Anlegen/Ändern zu `nameDuplicate`; alles
  andere wird weitergeworfen.

## Steuerjahr-Service (#16)

`src/business/tax-years` – `createTaxYearService({ unitOfWork })` mit
`get(year)`, `list()`, `addYear(year)`, `setSmallBusiness(year, value,
options?)`. Gleiche Konventionen wie Buchungs- und Kategorien-Service (eine
Unit of Work pro Operation, Ergebnisobjekte mit Feldcodes
`TaxYearFieldErrorCodes`).

- **Default regelbesteuert:** Ein Jahr ohne Datensatz in `tax_years` ist
  regelbesteuert. `get` liefert `{ year, smallBusiness, explicit }`
  (`explicit` = Datensatz vorhanden).
- **`list()`** liefert alle Jahre mit Datensatz **oder** mit Buchungen
  (`BookingRepository.listYears()`), aufsteigend; Jahre nur mit Buchungen
  erscheinen mit dem Default (`explicit: false`). Die Einstellungsseite (#20)
  zeigt so auch Jahre, die nie bewusst eingestellt wurden. Jedes Jahr trägt
  `mismatchedBookings` (`TaxYearOverview`): die Zahl der Buchungen, deren
  USt-Satz nicht zum Status passt (gezählt nur für Jahre mit Buchungen, in
  derselben Unit of Work).
- **`addYear(year)`** („Jahr hinzufügen“, #20) legt das Jahr regelbesteuert
  an, z. B. um den Status vor der ersten Buchung zu setzen; existiert schon
  ein Datensatz: `yearExists`. `setSmallBusiness` legt fehlende Datensätze
  ebenfalls an.
- **Validierung:** Jahr sichere Ganzzahl 1000–9999 (`invalidYear`, wie
  Buchungsdatum und DB-CHECK; `get`/`addYear` ohne Datenbankzugriff), Wert
  zur Laufzeit ein Boolean (`invalidValue`).
- **Statuswechsel bei vorhandenen Buchungen:** Wechselt ein Jahr zu
  Kleinunternehmer, passen dessen Buchungen **mit** USt-Satz nicht mehr; beim
  Wechsel zu regelbesteuert die **ohne** Satz („unpassende Buchungen“). Ein
  solcher Wechsel wird abgelehnt mit
  `{ ok: false, reason: "conflicts", mismatchedBookings }` – nichts wird
  geschrieben. Die UI fragt nach und wiederholt mit
  `{ acknowledgeConflicts: true }` (nur `true` zählt); dann wird gespeichert,
  das Ergebnis nennt `mismatchedBookings`. Prüfung und Schreiben laufen in
  derselben Unit of Work. Bleibt der Status gleich, gibt es keinen Konflikt
  (`mismatchedBookings` zählt trotzdem verbliebene unpassende Buchungen).
- **Buchungen werden nie umgeschrieben:** Beim Wechsel zu regelbesteuert ist
  nicht ableitbar, welcher Satz gilt. Eine unpassende Buchung bleibt ladbar
  und löschbar; beim nächsten Speichern verlangt der Buchungs-Service einen
  zum Jahr passenden Satz (`vatRateNotAllowed` bzw. `vatRateRequired`) – das
  Formular (#18) zeigt das USt-Feld nach dem Status des Jahres.
- **Warum nicht einfach blockieren:** Eine unpassende Buchung lässt sich
  nicht vorab in den Zielzustand bringen, solange das Jahr den alten Status
  hat (der Buchungs-Service prüft gegen den aktuellen Status). Ein hartes
  Verbot ließe nur Löschen und Neuerfassen aller Buchungen des Jahres.

## EÜR-Positionen (#13)

`src/business/euer` enthält die stabilen EÜR-Positionen, das Zeilen-Mapping
pro Steuerjahr (`describePosition(position, year)`), die Umleitung im
Kleinunternehmer-Jahr (`positionForTaxStatus`) und die Prüfung der Position
einer Kategorie (`validateCategoryPosition`). Die Standardkategorien legt die
Migration `0001_default_categories` an. Details, Quellen und das Vorgehen für
ein neues Steuerjahr: [Datenmodell](data-model.md#eür-positionen-13).

## EÜR-Service (#25)

`src/business/euer` – `createEuerService({ unitOfWork })` mit
`calculate(year)`, in `AppServices` als `euer`. Eine Unit of Work liest den
Steuerstatus (ohne Datensatz regelbesteuert, #16), alle Kategorien (inkl.
archivierter) und `BookingRepository.sumByCategoryAndVatRate(year)`; die
Rechnung selbst ist die reine Funktion `calculateEuer`. Ergebnis
`{ ok: true, euer }` oder `invalidYear` (ohne Datenbankzugriff). Regeln,
Entscheidungen und Ergebnisform:
[Datenmodell](data-model.md#eür-berechnung-25).

## App-Shell & Routen

| Route                   | Bereich                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `/`                     | Weiterleitung auf `/buchungen` (Startseite)                         |
| `/buchungen`            | Buchungsliste; Filter/Sortierung/Seite als Search-Params (#22, #23) |
| `/buchungen/$bookingId` | Buchung bearbeiten (Formular, #18)                                  |
| `/buchungen/neu`        | Neue Buchung (Formular, #18)                                        |
| `/euer`                 | EÜR-Jahresansicht                                                   |
| `/kategorien`           | Kategorienverwaltung                                                |
| `/einstellungen`        | Einstellungen (Steuerjahre, später Stripe)                          |
| alles andere            | `notFoundComponent` der Root-Route, innerhalb der Shell             |

- **Pfade sind deutsch** wie die Fachbegriffe und die (einzige) UI-Sprache;
  Code-Bezeichner bleiben englisch (`BookingsPage`, `bookings_title`).
- `/` leitet weiter, statt die Buchungen selbst zu rendern: So gibt es genau
  eine URL für die Liste samt Search-Params, und die Navigation markiert sie
  eindeutig als aktiv.
- Das Layout (`src/ui/layout/app-shell.tsx`) rendert die Root-Route um das
  `<Outlet />`. Seiten nutzen `Page` aus `src/ui/layout/page.tsx` und setzen
  den Dokumenttitel über `head` (`m.page_title({ page })`).
- Gescrollt wird der Inhaltsbereich (`#app-content`), nicht das Fenster;
  der Router setzt ihn bei Navigation zurück (`scrollToTopSelectors`).
  Ein Skip-Link springt dorthin.
- Tests liegen nicht als Routen vor: `routeFileIgnorePattern` in
  `vite.config.ts` schließt `*.test.ts[x]` und `__tests__/` in `src/routes`
  aus.

### App-Start (Composition Root)

`src/routes/__root.tsx` umschließt die Shell mit `AppServicesProvider`
(`src/app/app-services.tsx`). Dieser ruft in einem Effekt einmalig
`startApp()` (`src/app/startup.ts`) auf: Datenbank öffnen, ausstehende
Migrationen anwenden ([Datenmodell](data-model.md)), Unit of Work und Services
erzeugen (`createAppServices`, `src/app/services.ts`). `AppServices` enthält
nur Services (`bookings`, `bookingExport`, `categories`, `taxYears`), keine Repositories und
keine Unit of Work: UI und Routen gehen immer über die Services. Bis dahin zeigt er einen
Ladebildschirm, danach die App; Komponenten holen die Services mit
`useAppServices()`.

- **Nur im WebView:** Der Start läuft im Effekt. Beim Vorrendern der
  SPA-Shell (Node) gibt es kein Tauri; die Shell enthält den Ladebildschirm.
- **Fehler** zeigt ein deutscher Fehlerbildschirm
  (`src/ui/layout/startup-screen.tsx`) mit den technischen Details (Fehler
  samt `cause`-Kette) und „Erneut versuchen“ (lädt die Seite neu).
- **Datenbank nicht geöffnet:** Kann der Host die Datei nicht öffnen
  (`src-tauri/src/lib.rs`), protokolliert er nur die Ursache; jede Abfrage
  scheitert dann mit „database sqlite:belegwerk.db not loaded“. Der
  Fehlerbildschirm erkennt das (`isDatabaseNotLoaded`) und verweist auf das
  Protokoll in `%LOCALAPPDATA%\de.belegwerk.desktop\logs` (Standardziel
  `LogDir` von `tauri-plugin-log`, Tauri `app_log_dir`).
- **Browser ohne Tauri** (`pnpm dev` direkt im Browser): Es gibt keine
  Datenbank; der Fehlerbildschirm weist darauf hin, die App mit
  `pnpm tauri dev` zu starten.
- Services werden nicht als Router-Context an Loader gegeben (es gibt sie
  erst nach dem Start im Provider); die Buchungsseiten laden per `useQuery`
  in der Komponente.

### TanStack Query

`src/app/query-client.ts` erzeugt den `QueryClient` (Composition Root:
Defaults wie `retry: false` sind App-Konfiguration, kein UI-Detail).
`src/router.tsx` legt pro Router-Instanz einen Client an, stellt ihn über
`Wrap` per `QueryClientProvider` bereit und gibt ihn als Router-Context
(`context.queryClient`) an Loader weiter.

**Query-Keys** liegen pro Bereich mit den Hooks in `src/ui/<bereich>/*-queries.ts`,
z. B. `bookingQueryKeys` in `src/ui/bookings/booking-queries.ts`:
`["bookings"]` (alles), `["bookings", "list", query]` (Suche mit ihrem
`BookingQuery`, #21; Präfix `bookingQueryKeys.lists()`) und `["bookings", "detail", id]` (nur für
ganzzahlige IDs; `NaN` ergäbe den gemeinsamen Key `[…, null]`). Ebenso
`categoryQueryKeys` (`src/ui/categories/category-queries.ts`,
`useCategoryList()`) und `taxYearQueryKeys`
(`src/ui/tax-years/tax-year-queries.ts`, `useTaxYear(year)`,
`useTaxYearList()`).
Buchungs-Mutationen (`useBookingMutations()`, #18) invalidieren
`bookingQueryKeys.all`, `categoryQueryKeys.all` (`bookingCount`) und
`taxYearQueryKeys.all` (`list()` enthält Jahre mit Buchungen). Verlässt das
Formular danach die Seite (Erfolg, „nicht gefunden“), werden nur inaktive
Queries neu geladen – sonst zeigte die Bearbeiten-Seite eine eben gelöschte
Buchung kurz als „nicht gefunden“.

### Buchungsliste (#17)

- `src/routes/buchungen.index.tsx` (`/buchungen`) lädt mit
  `useBookingList(query)` und zeigt Lade-, Fehler- (mit „Erneut versuchen“)
  und Leerzustand. Filter (#22), Sortierung, Seite und Seitengröße (#23)
  kommen aus den URL-Parametern.
- `src/ui/bookings/booking-table.tsx` rendert die Zeilen mit TanStack Table
  (v9: `useTable`, `tableFeatures`, `columnMeta` für Spaltenklassen), ohne
  eigene Sortierung/Pagination – das macht die Suche per SQL (#21, #23).
- **Art** als Text mit Pfeil-Icon und Farbe, Brutto in der Farbe der Art (nie
  nur Farbe). Beträge rechtsbündig mit `tabular-nums` und `formatCurrency`,
  Datum mit `formatDate`. Archivierte Kategorien sind markiert. Lange Texte
  werden gekürzt (voller Text im `title`), damit die Tabelle ins
  Standardfenster (1280 px) passt.
- **Bearbeiten:** Klick auf die Zeile navigiert zu `/buchungen/$bookingId`;
  für die Tastatur ist die Beschreibung ein Link (Tab, Enter). Klicks auf den
  Link und Klicks mit Modifier (Strg/Shift/Alt/Meta) lösen keine
  Zeilennavigation aus. Die Route parst die ID zu einer Zahl (sonst `NaN` →
  „nicht gefunden“ ohne Abfrage) und zeigt eine unbekannte Buchung auf der
  Seite an, ohne `notFound()` – den 404-Titel erkennt die Root-Route an
  `_notFound`, das gilt nur für unbekannte Pfade.

### Filter und Suche (#22)

Suchfeld und Filterleiste (`src/ui/bookings/booking-filter-bar.tsx`) über der
Liste. Die reine Logik – URL-Schema, Abbildung auf `BookingQuery`,
Schnellwahl-Zeiträume, Kategorie-Optionen – liegt getestet in
`booking-filter-model.ts`.

**URL-Schema** (`validateSearch: validateBookingSearch`, alle Parameter
optional; Standardwerte stehen nie in der URL):

| Parameter                | Wert                                  | `BookingQuery`           |
| ------------------------ | ------------------------------------- | ------------------------ |
| `q`                      | Suchtext (getrimmt)                   | `text`                   |
| `von`, `bis`             | Zahlungsdatum `YYYY-MM-DD`, inklusive | `dateFrom`, `dateTo`     |
| `art`                    | `einnahmen` oder `ausgaben`           | `type`                   |
| `kategorie`              | Kategorie-IDs (Array, z. B. `[1,7]`)  | `categoryIds`            |
| `quelle`                 | `manuell` oder `stripe`               | `source`                 |
| `betragVon`, `betragBis` | Brutto in **Cent**                    | `amountFrom`, `amountTo` |
| `sortierung`             | `<spalte>-<auf\|ab>` (#23)            | `sort`                   |
| `seite`                  | Seite ab 2 (#23)                      | `page`                   |
| `proSeite`               | 25, 100 oder 200 (#23)                | `pageSize`               |

- **Serialisierung:** Standard von TanStack Router (Werte als JSON, wo
  nötig). Strings, die wie JSON aussehen, werden gequotet (`?q=2025` wird
  zu `?q="2025"`); Arrays erscheinen als `kategorie=[1,7]`. Beträge als
  Cent und Daten als ISO halten die URL unabhängig vom Anzeigeformat.
- **Ungültige Parameter** führen nie zu einem Fehler: Unlesbares
  (unbekannte Art/Quelle, unmögliches Datum, kein Cent-Betrag 0 bis
  `MAX_AMOUNT_CENTS`, keine
  ID) wird verworfen, der Router schreibt die URL bereinigt zurück.
  Lesbare, aber widersprüchliche Werte (`bis` vor `von`, `betragBis` <
  `betragVon`, Steuerzeichen oder zu langer Suchtext) bleiben stehen;
  `normalizeBookingQuery` meldet sie, die Filterleiste zeigt den Fehler am
  Feld, die Liste einen Hinweis statt Ergebnissen (keine Abfrage).
- **Vorsicht Router:** Die Suche einer Route wird über die der Elternroute
  gelegt, und die Root-Route behält die Roh-Parameter. `validateBookingSearch`
  liefert deshalb jeden Schlüssel des Schemas, verworfene als `undefined` –
  sonst schiene z. B. `art=foo` durch. Unbekannte Parameter scheinen durch,
  werden ignoriert und bei der nächsten Filteränderung entfernt.
- **Zeitraum:** Gespeichert werden nur `von`/`bis`; die Schnellwahl (Jahr,
  Quartal, Monat) wird daraus abgeleitet (`detectPeriod`), wenn sie genau
  passt – eine URL hat so genau eine Bedeutung, ein zusätzlicher
  `zeitraum`-Parameter könnte den Daten widersprechen. „Frei“ (zwei
  Datumsfelder) bleibt gewählt, solange es benutzt wird, auch wenn die Daten
  zufällig einen ganzen Monat ergeben – bis eine andere Schnellwahl gewählt,
  zurückgesetzt oder der Zeitraum von außen geändert wird (Zurück/Vor). Jahre zur Auswahl: Steuerjahre und
  Jahre mit Buchungen (`useTaxYearList`), das aktuelle und das gewählte.
- **Historie:** Auswahlen (Zeitraum, Art, Kategorien, Quelle, Zurücksetzen)
  erzeugen einen Eintrag, Zurück/Vor stellt sie wieder her. Getippte Werte
  (Suchtext 300 ms, Beträge/freie Daten 500 ms entprellt; Enter/Verlassen
  sofort) erzeugen beim Setzen oder Leeren einen Eintrag und ersetzen ihn
  beim Weitertippen – so landet nicht jeder Tastendruck in der Historie.
  Ändert sich die URL von außen (Zurück, Zurücksetzen), übernehmen die
  Felder den Wert und verwerfen ausstehende Eingaben (`useDebouncedInput`).
- **Art und Kategorien:** Die Mehrfachauswahl (Base UI `Select multiple`)
  gruppiert nach Art, archivierte markiert; mit Art-Filter nur deren
  Kategorien. Gewählte Kategorien der anderen Art und IDs ohne Kategorie
  (aus einer URL) stehen markiert in der Liste, damit sie sich abwählen
  lassen.
  Ein Art-Wechsel entfernt Kategorien der anderen Art.
- **Beträge** mit Dezimalkomma (`parseAmount`); unlesbare Eingaben zeigen
  einen Fehler und ändern die URL nicht.
- **Ergebnis:** „N Buchungen gefunden“ (`role="status"`); mit Filtern ohne
  Treffer „Keine Buchungen passen zu den Filtern“ samt „Filter
  zurücksetzen“, ohne Filter weiterhin „Noch keine Buchungen“. Während eine
  neue Suche lädt, bleibt das alte Ergebnis gedimmt stehen (nur ein
  erfolgreiches, `placeholderData`); ein ungültiger Filter fragt nicht ab
  (`enabled: false`).
- **Zurücksetzen** leert alle Filter (deaktiviert, wenn keiner aktiv ist;
  daneben „N Filter aktiv“), baut die Filterleiste neu auf und setzt den
  Fokus ins Suchfeld.
- **Zurücksetzen** behält Sortierung und Seitengröße (#23), die Seite geht
  auf 1.

### Sortierung, Seiten und Summen (#23)

- **`sortierung`:** Spalte und Richtung in einem Parameter, damit eine URL
  nur eine Bedeutung hat: `datum`, `art`, `beschreibung`, `gegenpartei`,
  `kategorie`, `netto`, `ust`, `brutto`, `quelle` (je ein
  `BOOKING_SORT_FIELDS`), dazu `-auf` (aufsteigend) oder `-ab`
  (absteigend), z. B. `?sortierung=brutto-auf`. Standard `datum-ab` steht
  nicht in der URL. Abbildung in `booking-filter-model.ts` (`sortParam`,
  `parseSortParam`, `sortSearchParam`, `bookingSearchSort`).
- **`seite`** ab 1 (Seite 1 nicht in der URL), **`proSeite`** aus
  `BOOKING_PAGE_SIZES` (25/50/100/200; 50 nicht in der URL). Andere Werte
  werden wie bei den Filtern verworfen. `bookingSearchToListQuery` baut
  daraus das Query der Liste.
- **Seite zurück auf 1:** `updateBookingSearch` entfernt `seite`, sobald
  sich etwas anderes ändert – Filter, Sortierung oder Seitengröße –, außer
  der Patch setzt `seite` selbst. Seiten- und Sortierwechsel erzeugen je
  einen Historieneintrag.
- **Seite hinter der letzten** (alter Link, letzte Buchung einer Seite
  gelöscht): Die Suche liefert die letzte Seite (#21); die Liste gleicht
  `seite` an die gelieferte an, per `replace` (Zurück führt nicht auf die
  leere Seite). Nur für ein frisches Ergebnis (nie Platzhalterdaten, nie ein gecachtes, das gerade neu lädt) – das
  nächste Ergebnis hat die angefragte Seite, es gibt keine Schleife.
- **Spaltenköpfe** sind Buttons (Tab, Enter/Leertaste): die sortierte
  Spalte wechselt die Richtung, eine andere beginnt mit ihrer
  Startrichtung (`initialSortDirection`: Datum und Beträge absteigend,
  Texte, Art und Quelle aufsteigend). Die sortierte Spalte hat `aria-sort`
  und einen Pfeil, der Tooltip nennt die Aktion („Nach Brutto aufsteigend
  sortieren“), die Caption die aktuelle Sortierung. Keine TanStack-Sortierung:
  die Zeilen kommen sortiert aus SQL.
- **Pagination** (`booking-pagination.tsx`, `<nav>`) unter der Tabelle:
  „51–100 von 120“, „Pro Seite“, Erste/Vorherige/Nächste/Letzte (Icons mit
  `aria-label`, deaktiviert am Rand, aber fokussierbar – der Fokus bleibt nach „Letzte Seite“ stehen), „Seite X von Y“ (`aria-live`).
- **Summenzeilen** im `tfoot`: Einnahmen, Ausgaben, Saldo (brutto) des
  **gesamten** gefilterten Bestands (`sums`), unter der Brutto-Spalte; der
  Text daneben sagt „nicht nur dieser Seite“. Der Saldo hat Vorzeichen und
  Wort („Überschuss“/„Fehlbetrag“), nicht nur Farbe.
- **CSV-Export (#24):** `bookingSearchToQuery(search)` plus
  `sort: bookingSearchSort(search)` und `pageSize: "all"` – derselbe Filter
  und dieselbe Sortierung wie die Liste, alle Seiten (siehe
  [CSV-Export](#csv-export-24)).

### CSV-Export (#24)

„CSV exportieren“ im Kopf der Buchungsliste
(`src/ui/bookings/booking-export-button.tsx`) speichert **alle** Buchungen der
aktuellen Filter in der Sortierung der Liste, nicht nur die Seite.

**CSV-Format** (`src/business/csv`, `toCsv(rows)`; gilt für alle Exporte,
auch die EÜR #27):

| Punkt         | Festlegung                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Trennzeichen  | `;` (Listentrennzeichen von Excel in de-DE)                                                                                |
| Zeilenende    | CRLF nach **jeder** Zeile, auch der letzten (RFC 4180, Excel unter Windows)                                                |
| Kodierung     | UTF-8 mit BOM: `toCsv` setzt U+FEFF an den Anfang (genau eine Stelle); geschrieben `EF BB BF`                              |
| Quoting       | Felder mit `;`, `"`, CR oder LF in `"…"`, innere `"` verdoppelt; sonst unverändert                                         |
| Datum         | `TT.MM.JJJJ` (`formatDate`)                                                                                                |
| Beträge       | `formatAmountPlain`: Dezimalkomma, kein Tausenderpunkt, kein `€`, ASCII-Minus (`1234,56`, `-0,05`)                         |
| Leere Felder  | `null` → leeres Feld (z. B. USt-Satz im Kleinunternehmer-Jahr, Referenz/Notiz/externe ID)                                  |
| Formel-Schutz | Text, der (auch nach Leerraum) mit `=`, `+`, `-`, `@` oder mit Tab/CR beginnt, bekommt ein `'` davor (OWASP CSV Injection) |

- **Formel-Schutz nur für Texte:** Zellen sind `string` (Nutzer- oder
  Label-Text, geschützt), `csvLiteral(…)` (von der App formatiert: Beträge,
  Daten – unverändert, damit z. B. ein negativer Saldo der EÜR eine Zahl
  bleibt) oder `null`. Der Schutz ändert den sichtbaren Wert (`'-Rabatt`);
  das betrifft nur Texte, die so beginnen, und ist der übliche Kompromiss.
- **Spalten** (`BOOKING_CSV_COLUMNS`, `bookingsToCsv(items, labels)` in
  `src/business/bookings/booking-csv.ts`): Datum, Art, Beschreibung,
  Gegenpartei, Kategorie, Netto, USt-Satz, USt, Brutto, Referenz, Notiz,
  Quelle, Externe ID. Kopfzeile und Werte-Labels (Einnahme/Ausgabe,
  USt-Sätze, Manuell/Stripe) sind UI-Texte: die UI übergibt sie
  (`bookingCsvLabels()` in `booking-messages.ts`), Business bleibt frei von
  Paraglide und testbar.
- **Dateiname** (`csvFileName`): nach dem Zeitraum des Filters,
  `buchungen-2025-01-01_2025-12-31.csv`, offen `buchungen-ab-2025-01-01.csv`
  bzw. `buchungen-bis-….csv`, ohne Zeitraum das Exportdatum
  `buchungen-2026-11-14.csv`. Wörter aus Paraglide; unter Windows verbotene
  Zeichen werden `_`. Dialogfilter „CSV-Datei“ (`*.csv`).
- **Service** `createBookingExportService({ bookings, fileSaver })`,
  `exportCsv({ query, labels, fileName, filterName })`: lädt per
  `BookingService.list({ ...query, page: 1, pageSize: "all" })` (vor dem
  Dialog – ungültige Filter öffnen ihn nie), baut die Datei und speichert sie
  über den `FileSaver`. Ergebnis `{ ok: true, saved: true, fileName, count }`,
  `{ ok: true, saved: false }` (Abbruch) oder `{ ok: false, reason:
  "invalid", errors }`; Lade-/Schreibfehler werfen. Keine Obergrenze: der
  Bestand einer lokalen EÜR-App passt in den Speicher.
- **Button:** deaktiviert (fokussierbar, Grund im Tooltip), solange die Filter
  ungültig sind, nichts geladen ist, nichts passt oder ein Export läuft
  (dann mit Spinner und „Exportiere …“). Die Anzahl kommt aus derselben
  Listen-Abfrage wie die Tabelle (gleicher Query-Key), nie aus Platzhalterdaten der vorigen Suche. Erfolg: Toast mit
  Anzahl und Dateiname; Abbruch des Dialogs: kein Toast; Fehler (z. B. Datei
  in Excel geöffnet): Fehler-Toast, Details in der Konsole.

### Buchungsformular (#18)

`src/ui/bookings/booking-form.tsx` (TanStack Form) dient `/buchungen/neu`
und `/buchungen/$bookingId`; die reine Logik (Werte, Umwandlung in
`BookingFormInput`, Client-Prüfungen, Vorschau, Kategorie-Optionen) liegt
getestet in `booking-form-model.ts`, die Texte zu Fehlercodes in
`booking-messages.ts`.

- **Werte sind Strings;** beim Absenden wird daraus `BookingFormInput`. Quelle
  und externe ID werden nie gesendet (`update` behält sie); importierte
  Buchungen zeigen sie nur zur Information.
- **Validierung:** Der Service ist maßgeblich. Das Formular prüft vorab nur,
  was es selbst weiß (Pflichtfelder, Betragstext per `parseAmount`, Betrag
  größer 0) – beim Absenden, danach bei jeder Änderung
  (`revalidateKeepingServerErrorsOnBlur` in `src/ui/forms/validation-logic.ts`:
  `revalidateLogic()`, aber Verlassen eines Feldes löscht keine Service-Fehler).
  Service-Fehler werden pro Feld als `errorMap.onServer` gesetzt und bleiben,
  bis sich der Wert ändert oder erneut abgesendet wird. Form-core löscht sie
  nur bei Feldern mit `validators`; Felder ohne Client-Prüfung (Art, Referenz,
  Notiz) haben deshalb einen No-op-Validator (`noValidation`). Fehler zu
  Quelle/externer ID erscheinen über den Buttons. Nach einem fehlgeschlagenen
  Absenden bekommt das erste ungültige Feld den Fokus (im Kleinunternehmer-Jahr
  ggf. der Hinweis statt des USt-Felds); Fehlertexte hängen per
  `aria-describedby` am Feld.
- **Datum:** natives `<input type="date">` (liefert ISO; WebView2 zeigt das
  Systemformat, z. B. `TT.MM.JJJJ`, samt Kalender). Neue Buchungen starten
  mit heute, Ausgabe und 19 %.
- **Betrag:** Textfeld mit Dezimalkomma; beim Verlassen wird ein gültiger
  Betrag normalisiert (`1.500` → `1.500,00`, der Punkt ist Tausendertrenner).
- **USt-Satz** nur im regelbesteuerten Jahr des Datums (`useTaxYear`); bei
  unvollständigem Datum gilt das Jahr als regelbesteuert. Im
  Kleinunternehmer-Jahr steht stattdessen ein Hinweis, gesendet wird `null`.
  Die Seiten laden den Status des Anfangsdatums vor dem Formular (kein
  Flackern).
- **Vorschau** Netto/USt/Brutto live mit `calculateBookingAmounts`, „–“
  solange Betrag oder Satz ungültig sind.
- **Kategorie:** nur Kategorien der Art, ohne archivierte – außer der
  bisherigen Kategorie der bearbeiteten Buchung und der gerade gewählten
  (wird sie währenddessen archiviert, bleibt sie markiert sichtbar und der
  Service meldet `categoryArchived`). Wechselt die Art, wird eine unpassende
  Kategorie geleert.
- **Nach dem Speichern/Löschen** zurück zur Liste mit Toast; „nicht gefunden“
  ebenso, mit Hinweis. Löschen fragt in einem Alert-Dialog nach (Fokus auf
  „Abbrechen“, Escape schließt).

### Kategorienverwaltung (#19)

`src/routes/kategorien.tsx` (`/kategorien`) lädt mit `useCategoryList()` und
rendert `src/ui/categories/category-list.tsx`. Reine Logik (Gruppierung,
Positions-Optionen, Formularwerte, Client-Prüfungen) liegt getestet in
`category-model.ts`, die Texte zu Fehlercodes und die Positionsanzeige in
`category-messages.ts`, die Mutationen in `category-mutations.ts`.

- **Liste:** je eine Tabelle für Einnahmen und Ausgaben, nach Name sortiert.
  EÜR-Position als „Zeile N · Anzeigename“ für das **aktuelle Kalenderjahr**
  (`describePosition`; ohne Mapping nur der Anzeigename, die amtliche
  Bezeichnung im `title`). Markierungen „mindert Einnahmen“, „System“,
  „archiviert“; Spalte Buchungen (`bookingCount`).
- **Archivierte** sind standardmäßig ausgeblendet; „Archivierte Kategorien
  anzeigen (n)“ zeigt sie gedämpft am Ende ihrer Gruppe.
- **Anlegen/Bearbeiten** im Dialog (`category-form.tsx`, gleiche
  Validierungsmuster wie das Buchungsformular; `FormField`,
  `focusFirstInvalid` und `fieldErrors` liegen gemeinsam in
  `src/ui/forms/form-field.tsx`). Die Art wird nur beim Anlegen gewählt.
  „Mindert Einnahmen“ gibt es nur bei Ausgaben. Die Positionsauswahl
  (`positionOptions`) ist genau die Menge, die `validateCategoryPosition` für
  Art und Flag akzeptiert (Erlösminderung: nur die Umsatz-Positionen 15/16);
  ändern sich Art oder Flag, wird eine unpassende Position geleert. Bei
  Systemkategorien sind Position und Flag gesperrt (nur der Name wird
  gesendet). Hat die Kategorie Buchungen, weist das Formular darauf hin, dass
  eine Positionsänderung rückwirkend wirkt.
- **Archivieren/Reaktivieren** sofort mit Toast (umkehrbar, keine
  Rückfrage); nicht für Systemkategorien.
- **Löschen** nur bei `bookingCount === 0` und nicht System (sonst
  deaktiviert, Hinweis im `title`), mit Alert-Dialog (Fokus auf „Abbrechen“).
  Meldet der Service trotzdem `inUse`/`systemCategory` (Wettlauf), erscheint
  ein Toast mit dem Hinweis, stattdessen zu archivieren.
- **Invalidierung:** Kategorie-Mutationen invalidieren
  `categoryQueryKeys.all` und `bookingQueryKeys.all` (Buchungsliste zeigt
  Kategoriename und „archiviert“; das Buchungsformular bezieht seine Optionen
  aus der Kategorienliste).

### Einstellungen (#20)

`src/routes/einstellungen.tsx` (`/einstellungen`) stapelt Abschnitte
(`SettingsSection` aus `src/ui/settings/settings-section.tsx`: `<section>` mit
Überschrift und Beschreibung per `aria-labelledby`/`aria-describedby`). Jeder
Abschnitt lädt seine Daten selbst und zeigt eigene Lade-/Fehlerzustände; der
Abschnitt „Stripe“ (#28) kommt als weiterer `SettingsSection` darunter.

**Steuerjahre** (`src/ui/tax-years/tax-year-settings.tsx`; reine Logik
getestet in `tax-year-model.ts`, Texte in `tax-year-messages.ts`, Mutationen
in `tax-year-mutations.ts`):

- **Liste** aus `useTaxYearList()`, neueste Jahre zuerst: Jahr, Status
  (Regelbesteuerung / Kleinunternehmer § 19 UStG) und ein Schalter
  „Kleinunternehmer“ (shadcn `Switch`). Jahre ohne Datensatz tragen
  „Standard, nicht gespeichert“. Gibt es unpassende Buchungen
  (`mismatchedBookings > 0`), steht ein Hinweis in der Zeile – dauerhaft,
  weil er aus `list()` kommt, bis die Buchungen korrigiert sind.
- **Schalter** speichert sofort (`setSmallBusiness`) und zeigt den neuen Wert,
  solange gespeichert oder nachgefragt wird (dann `readOnly`, nicht
  `disabled`: der Fokus bleibt). Bei `conflicts` erklärt ein Alert-Dialog,
  dass N Buchungen nicht mehr passen, unverändert bleiben und beim nächsten
  Bearbeiten korrigiert werden müssen; „Trotzdem ändern“ wiederholt mit
  `acknowledgeConflicts: true`, „Abbrechen“ (Anfangsfokus) setzt den Schalter
  zurück. Erfolg: Toast.
- **Jahr hinzufügen:** kleines Formular (gleiches Validierungsmuster wie die
  anderen Formulare; Client-Prüfung leer/kein Jahr 1000–9999, Service-Fehler
  `invalidYear`/`yearExists` am Feld). Vorschlag: aktuelles Jahr, falls nicht
  gelistet, sonst das nächste.
- **Invalidierung:** nur `taxYearQueryKeys.all` (Liste und Status je Jahr,
  von dem das USt-Feld des Buchungsformulars abhängt). Buchungen und
  Kategorien ändern sich nicht; Buchungs-Mutationen invalidieren ihrerseits
  `taxYearQueryKeys.all`, so aktualisiert sich der Hinweis nach dem
  Korrigieren einer Buchung.

## Content Security Policy

`src-tauri/tauri.conf.json` setzt eine CSP: nur eigene Skripte, Styles
(inkl. Inline-Styles), Bilder/Fonts auch als `data:`, Netzwerk nur zu eigenen Assets und zur
Tauri-IPC. Tauri ergänzt beim Build `script-src` um Hashes der Inline-Skripte
der vorgerenderten Shell; `dangerousDisableAssetCspModification` bleibt aus.
`base-uri` und `form-action` sind auf `'self'` beschränkt.

**Achtung bei Styles:** Enthält das gebaute HTML ein `<style>`-Element, ergänzt
Tauri auch `style-src` um Hashes/Nonces. Dann ignorieren Browser
`'unsafe-inline'`, und zur Laufzeit eingefügte Styles würden blockiert. Derzeit
enthält die Shell kein `<style>` (CSS kommt als Datei).

Im Dev-Modus (`pnpm tauri dev`, Seite vom Vite-Server) greift die CSP nicht –
CSP-Probleme zeigen sich nur im gebauten Programm
(`pnpm tauri build --no-bundle`). Braucht ein späteres Plugin weitere Ziele
(z. B. `connect-src https://api.stripe.com` für den Stripe-Import (M6) über
`tauri-plugin-http`), wird die CSP gezielt erweitert.

## Lint & Format

| Script              | Zweck                            |
| ------------------- | -------------------------------- |
| `pnpm lint`         | oxlint (inkl. Layer-Grenzen)     |
| `pnpm format`       | oxfmt, formatiert alle Dateien   |
| `pnpm format:check` | oxfmt im Prüfmodus (für CI, #7)  |
| `pnpm typecheck`    | Paraglide kompilieren + `tsc -b` |
| `pnpm db:generate`  | SQL-Migrationen aus dem Schema   |

- **oxlint** ([`.oxlintrc.json`](../.oxlintrc.json)): Kategorien
  `correctness` und `suspicious` als Fehler, Plugins `typescript`, `unicorn`,
  `oxc`, `react` (inkl. Hooks-Regeln), `import`, `vitest`. Warnungen werden
  nicht verwendet – eine Regel ist entweder Fehler oder aus; `pnpm lint` läuft
  zusätzlich mit `--deny-warnings`, damit auch künftige Warnungen den Lauf
  scheitern lassen.
- **oxfmt** ([`.oxfmtrc.json`](../.oxfmtrc.json)): Prettier-kompatibel,
  `printWidth` 100, sonst Defaults (doppelte Anführungszeichen, Semikolons).
  Formatiert auch JSON, CSS und Markdown.
- Beide Tools sind exakt gepinnt, damit Formatierung und Lint-Ergebnisse nicht
  mit einem Minor-Update kippen.

### shadcn/ui-Komponenten

Die Dateien unter `src/ui/components/ui` werden wie eigener Code behandelt
und **mit oxfmt formatiert** (u. a. Semikolons statt shadcn-Stil). Nach einem
`shadcn add` einfach `pnpm format` ausführen. Lint-seitig gibt es keine
Ausnahmen; die aktivierten Kategorien (`correctness`, `suspicious`) melden in
den generierten Komponenten nichts. Stil-Regeln (`style`, `pedantic`) sind
bewusst nicht aktiv, damit künftige `shadcn add`-Läufe nicht gegen Lint
kämpfen. Meldet eine Regel später nur in generierten Komponenten, wird sie in
einem Override für `src/ui/components/ui/**` abgeschaltet statt die Komponente
umzuschreiben.

## TypeScript-Konfiguration

- `tsconfig.app.json` – `src/` (WebView-Code) ohne Testcode, **ohne**
  Node-Typen.
- `tsconfig.test.json` – Testcode unter `src/` (`*.test.ts[x]`,
  `__tests__/`), erbt von `tsconfig.app.json`, mit Node-Typen
  ([Tests](testing.md)).
- `tsconfig.node.json` – Konfigurationsdateien (`vite.config.ts`,
  `vitest.config.ts`, `drizzle.config.ts`), mit Node-Typen.
- `tsconfig.json` – nur Referenzen auf alle drei; `tsc -b` prüft alle.

## Tests

Vitest in der Node-Umgebung; Business mit In-Memory-Fakes, Persistence gegen
`better-sqlite3`. Konventionen: [docs/testing.md](testing.md).
