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

**Dateien speichern (#24, auch EÜR #27):** Port `FileSaver` (`src/business/files.ts`,
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
- **Regeln an einer Stelle:** `prepareBooking(input, lookups, existing?)`
  validiert, normalisiert und rechnet die Beträge, ohne zu schreiben; die
  Lesezugriffe gehen über `BookingLookups` (`repositoryBookingLookups(repos)`
  im Service, vorab geladene Daten im Stripe-Import #30).
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

| Feld                     | Bedeutung                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `text`                   | Teilstring in Beschreibung, Gegenpartei, Referenz oder Notiz; ohne Groß-/Kleinschreibung, auch Umlaute  |
| `dateFrom`, `dateTo`     | Zahlungsdatum `YYYY-MM-DD`, jeweils inklusive                                                           |
| `type`, `source`         | Art bzw. Quelle                                                                                         |
| `vatRates`               | einer der USt-Sätze, `null` = ohne Satz (#26; leer = alle; Duplikate egal; unbekannt: `invalidVatRate`) |
| `categoryIds`            | eine der Kategorien (leer = alle; Duplikate egal; höchstens 500)                                        |
| `amountFrom`, `amountTo` | **Brutto** in Cent, jeweils inklusive                                                                   |
| `sort`                   | `{ field, direction }`, Felder `BOOKING_SORT_FIELDS`; Standard Datum absteigend                         |
| `page`, `pageSize`       | Seite ab 1 (Standard 1); Größe 1–500 (Standard 50) oder `"all"`                                         |

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
  leere Texte/Daten und leere `categoryIds`/`vatRates` filtern nicht.
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

## Stripe-Einstellungen (#28)

`src/business/stripe` – `createStripeSettingsService({ unitOfWork })` mit
`get()`, `setApiKey(key)`, `deleteApiKey()`, `setDefaults(input)`, in
`AppServices` als `stripeSettings`. Gleiche Konventionen wie die anderen
Services (eine Unit of Work pro Operation, Ergebnisobjekte mit Feldcodes).

- **Speicherung** in der Key/Value-Tabelle `settings`
  (`STRIPE_SETTING_KEYS`): `stripe.apiKey` (Klartext, #1),
  `stripe.defaultVatRate` (`VatRate`), `stripe.feeCategoryId`,
  `stripe.refundCategoryId` (ID als Dezimaltext). Vom Import (#30)
  geschrieben: `stripe.lastImportAt` (`toISOString()` des letzten
  erfolgreichen Imports) und `stripe.lastImportTo` (spätestes importiertes
  Zeitraumende `YYYY-MM-DD`, Default-Start des Zeitraums in #31).
- **Der Schlüssel erreicht die UI nie:** `get()` liefert
  `{ apiKey: { masked, mode } | null, defaults }` – maskiert als Präfix plus
  die letzten vier Zeichen (`rk_live_…AbCd`), `mode` aus dem Präfix
  (`live`/`test`). Den vollen Schlüssel liest nur der Import mit
  `loadStripeImportSettings(repos)` **in seiner eigenen Unit of Work**
  (Business-intern, nicht Teil von `AppServices`). Schlägt das Speichern
  fehl, wirft `setApiKey` einen Fehler ohne Ursache – Drizzles Meldung
  enthielte die gebundenen Parameter, also den Schlüssel. Die UI speichert
  ihn ohne `useMutation` (TanStack Query behielte die Variablen im Cache),
  leert das Feld danach und protokolliert keine Fehlerdetails.
- **Schlüssel-Validierung** (`validateStripeApiKey`, auch vom Formular
  genutzt): getrimmt (`trimText`), dann nur Restricted Keys
  `rk_live_`/`rk_test_` mit 10–247 Buchstaben/Ziffern. Codes: `required`,
  `secretKeyNotAllowed` (`sk_…`: Vollzugriff aufs Stripe-Konto – die App
  speichert bewusst nur eingeschränkte Leseschlüssel),
  `publishableKeyNotAllowed` (`pk_…`), `invalidKey`. Benötigte Berechtigung:
  „Application fees: Lesen“ (Connect; Fee-Refunds sind Unterressource der
  Application Fees), sonst „Keine“.
- **Standardwerte** (`setDefaults({ defaultVatRate, feeCategoryId,
  refundCategoryId })`, alle drei zusammen; `validateStripeDefaults`, auch
  gegen gespeicherte Werte nutzbar): USt-Satz ein `VatRate` (`required`,
  `invalidVatRate`) – er gilt nur in **regelbesteuerten** Jahren, `null` gibt
  es nicht; Fee-Kategorie existiert, nicht archiviert, Einnahme und keine
  Finanzamt-Kategorie (USt-Erstattung, `categoryTaxOffice`); Refund-Kategorie
  existiert, nicht archiviert, Ausgabe und „mindert Einnahmen“ (Codes
  `required`, `categoryNotFound`, `categoryArchived`, `categoryTypeMismatch`,
  `categoryNotRevenueReduction`). Gespeicherte Werte, die nicht lesbar sind
  (bearbeitete DB), gelten als nicht gesetzt.
- **Vorschläge** (`suggestStripeDefaults(categories)`, nie automatisch
  gespeichert; das Formular wählt sie vor): Fees → erste nicht archivierte
  Einnahme-Kategorie auf `BETRIEBSEINNAHMEN_UST_PFLICHTIG` („Umsatzerlöse“),
  Refunds → bevorzugt die System-Erlösminderung („Erlösminderung /
  Rückerstattung“), gefunden über Position und Flag, **nie am Namen**;
  USt 19 % (Plattform-Fee an inländische Connected Accounts – der Nutzer
  bestätigt; EU-Ausland: Reverse Charge, Drittland: 0 %).
- **Für den Import (#30):** `loadStripeImportSettings(repos)` liefert
  `{ ok: true, apiKey, defaultVatRate, feeCategory, refundCategory }`,
  `noApiKey` oder `invalidDefaults` mit Codes – gespeicherte Werte werden neu
  geprüft (Kategorie inzwischen archiviert, gelöscht, geändert). Der Import
  bucht mit den Regeln des Buchungs-Service (`prepareBooking`), der die
  Jahresregel durchsetzt: In einem **Kleinunternehmer-Jahr** übergibt der
  Import `vatRate: null`, unabhängig vom Standard-Satz.

## Stripe-Client (#29)

Port `StripeClient` (`src/business/stripe/stripe-client.ts`), Implementierung
`createStripeHttpClient()` in `src/app/stripe-http-client.ts` über
`fetch` aus `tauri-plugin-http`; `createAppServices(database, clock,
fileSaver, stripeClient)` verdrahtet ihn, Tests geben einen Fake
(`src/business/__tests__/fake-stripe-client.ts`).

- **`listApplicationFees({ apiKey, createdFrom, createdTo })`** – alle Fees mit
  `createdFrom ≤ created ≤ createdTo` (Epoch-Sekunden, `created[gte]`/
  `created[lte]`), neueste zuerst, `limit=100` und Cursor `starting_after`
  solange `has_more`. Jede Fee mit **allen** Refunds: Stripe bettet die
  Refund-Liste ein; ist sie abgeschnitten (`has_more`) oder fehlt sie, holt
  der Client den Rest über `GET /v1/application_fees/{id}/refunds` (ebenfalls
  paginiert). Ergebnis `{ ok: true, fees }` oder `{ ok: false, error }` –
  alles oder nichts.
- **Domänentypen:** Fee `{ id ("fee_…"), amount (Cent, ≥ 0), currency
  (klein, "eur"), created (Epoch-Sekunden UTC), account ("acct_…"),
  livemode, refunds }`, Refund `{ id ("fr_…"), amount, currency, created }`.
  Jede Antwort wird geprüft; Abweichungen (kein JSON, falscher Typ, falsches
  ID-Präfix, Großbuchstaben-Währung, `has_more` ohne Daten) →
  `invalidResponse`.
- **`verifyAccess({ apiKey })`** – eine Fee (`limit=1`), prüft Schlüssel und
  Berechtigung; `{ ok: true, livemode }` (`null` ohne Fees). Genutzt von
  `stripeSettings.testConnection()` („Verbindung testen“ in den
  Einstellungen): liest den Schlüssel in einer Unit of Work und ruft Stripe
  **außerhalb** davon auf; `noApiKey` oder `{ reason: "stripe", error }`.
- **Fehlercodes** (`StripeClientError`, UI-Texte in
  `src/ui/stripe/stripe-messages.ts`, `stripeClientErrorMessage`, auch für
  #31): `invalidApiKey` (401), `permissionDenied` (403, z. B. fehlende
  Berechtigung „Application fees: Lesen“), `rateLimited` (429 nach den
  Wiederholungen, mit `retryAfterSeconds` aus `Retry-After` oder `null`),
  `network` (nicht erreichbar, TLS, Proxy, vom HTTP-Scope abgelehnt),
  `timeout` (30 s je Anfrage), `stripeError` (andere Status, mit Stripes
  `error.code`/`error.message` oder `null`), `invalidResponse`.
- **Wiederholungen:** bis zu drei Versuche je Anfrage bei 429, bei
  vorübergehenden Serverfehlern (500/502/503/504) und bei `network` (keine
  Antwort); gewartet wird `Retry-After` (höchstens 10 s), sonst 1 s, 2 s.
  Danach `rateLimited`, `stripeError` bzw. `network`. Auch eine Ablehnung durch den
  HTTP-Scope kommt als `network` an und wird wiederholt (nur am
  Meldungstext unterscheidbar). `timeout` wird nicht
  wiederholt (sonst Minuten Wartezeit). Alles sind GETs – Wiederholen ist
  gefahrlos. `createdFrom > createdTo` ist ein Programmierfehler
  (`RangeError`).
- **Schlüssel:** nur im Header `Authorization: Bearer …`, nie in der URL;
  in keinem Ergebnis, Fehler oder Log (Fehler der Plugin-Aufrufe werden auf
  Codes reduziert, ohne Meldung). `Stripe-Version` ist gepinnt
  (`STRIPE_API_VERSION`, `2026-10-28.endive`) – die Validierung ist gegen
  diese Version geschrieben.
- **Tauri:** `tauri-plugin-http` (Rust, ohne Cookie-Store). Capability
  `http:default` mit Scope **nur** `https://api.stripe.com/v1/application_fees`
  (Liste) und `https://api.stripe.com/v1/application_fees/*`
  (Refunds-Unterressource; anderer Host, anderer Pfad wie
  `/v1/application_feesX`, `http:` → vom Plugin abgelehnt). Query-Strings
  passen trotzdem: das Plugin setzt eine im Muster fehlende Suche auf `*`
  (`parse_url_pattern` in `tauri-plugin-http/src/scope.rs`). Weiterleitungen: der Client setzt
  `maxRedirections: 0`, zusätzlich prüft `plugins.http.scopeRedirects` in
  `tauri.conf.json` jedes Weiterleitungsziel gegen den Scope. Die Anfrage
  führt Rust aus, die WebView spricht nur über die IPC – **keine
  CSP-Änderung** (`connect-src` bleibt bei `'self' ipc: http://ipc.localhost`).

**Datum (`src/business/stripe/stripe-dates.ts`):** `created` ist ein
Zeitpunkt (UTC). Buchungsdatum ist der Kalendertag in **Europe/Berlin**
(`stripeCreatedToBookingDate`, per `Intl`, unabhängig von der Zeitzone des
Rechners): 31.12. 23:30 UTC gehört zum 01.01. des Folgejahres.
`bookingDateRangeToStripeCreated(from, to)` macht aus einem Zeitraum in
Kalendertagen den `created`-Bereich (00:00:00 von `from` bis 23:59:59 von
`to`, Berliner Zeit, auch an Tagen mit 23/25 Stunden).

**Refunds und Zeitraum – Vorgabe für den Import (#30):** Stripe hat keine
Liste aller Fee-Refunds nach Datum, nur Fees nach `created` und Refunds je
Fee. Refunds bekommen ihr **eigenes** Datum (`refund.created`), nicht das der
Fee. Damit ein Refund im Zeitraum auf einer älteren Fee nicht fehlt, holt der
Import Fees ab `createdFrom − STRIPE_FEE_REFUND_LOOKBACK_DAYS` (180 Tage,
`subtractDays`) und bucht dann

- Fees mit `created` im Zeitraum,
- Refunds mit `created` im Zeitraum (egal, wann ihre Fee erstellt wurde).

Refunds außerhalb des Zeitraums bleiben für einen späteren Import liegen; der
Duplikatschutz über die externe ID (`fee_…`/`fr_…`) verhindert Doppelungen.
**Bekannte Grenze:** Ein Refund auf eine Fee, die mehr als 180 Tage vor dem
Zeitraum erstellt wurde, wird nicht gefunden (in der Praxis selten – Refunds
folgen der Erstattung der Zahlung). Mehr Rückblick kostet nur Anfragen
(100 Fees je Seite).

## Stripe-Import (#30)

`src/business/stripe/stripe-import-service.ts` –
`createStripeImportService({ unitOfWork, stripeClient, clock })` mit
`import({ from, to })` und `getStatus()`, in `AppServices` als
`stripeImport`.

- **Ablauf:** (1) Unit of Work: `loadStripeImportSettings`. (2) **Außerhalb**
  jeder Unit of Work: `listApplicationFees` von `from − 180 Tage` bis Ende
  `to` (siehe [Stripe-Client](#stripe-client-29)). (3) Fees und Refunds mit
  **eigenem** `created` im Zeitraum auswählen, älteste zuerst (Fee vor ihrem
  Refund), doppelt gelistete IDs nur einmal. (4) **Eine** Unit of Work:
  Einstellungen erneut laden (können sich während der Anfrage geändert haben
  → ggf. `noApiKey`/`invalidDefaults`), vorhandene externe IDs (Quelle
  `stripe`, `findExistingExternalIds` in einer Abfrage) überspringen, den
  Rest validieren und anlegen, `stripe.lastImportAt`/`lastImportTo`
  schreiben. Ein unerwarteter Fehler rollt alles zurück (keine Buchung, kein
  Zeitstempel) und wird geworfen. Wurde der API-Schlüssel während der
  Anfrage ersetzt, bucht der Import nichts und liefert
  `{ ok: false, reason: "settingsChanged" }` (die Fees gehören evtl. zu
  einem anderen Konto) – erneut importieren.
- **Grenze des Rückblicks:** Refunds auf Fees, die **mehr als 180 Tage vor
  `from`** erstellt wurden, sieht der Import **nie** – auch wenn der Refund
  selbst im Zeitraum liegt (Stripe listet Refunds nur je Fee, die Fee liegt
  außerhalb des abgefragten Bereichs). Solche Refunds müssen manuell gebucht
  werden.
- **Zeitraum:** `from`/`to` inklusive Kalendertage (Europe/Berlin). Codes
  `required`, `invalidDate`, `beforeFrom` (`to` vor `from`), `inFuture`
  (`to` nach heute – es würde Start des nächsten Imports).
- **Mapping:**

  | Feld         | Fee                         | Refund                                    |
  | ------------ | --------------------------- | ----------------------------------------- |
  | Datum        | `fee.created` (Berlin)      | `refund.created` (Berlin)                 |
  | Art          | Einnahme                    | Ausgabe                                   |
  | Brutto       | `amount`                    | `amount`                                  |
  | USt-Satz     | Standard; `null` im KU-Jahr | Standard; `null` im KU-Jahr               |
  | Kategorie    | Fee-Kategorie               | Refund-Kategorie (mindert Einnahmen)      |
  | Beschreibung | „Stripe Application Fee“    | „Stripe Application Fee – Rückerstattung“ |
  | Gegenpartei  | Connected Account `acct_…`  | Connected Account der Fee                 |
  | Referenz     | –                           | `fee_…` der erstatteten Fee               |
  | Notiz        | –                           | –                                         |
  | Quelle / ID  | `stripe` / `fee_…`          | `stripe` / `fr_…`                         |

  Die Beschreibungen sind gespeicherte Fachwerte (wie die Namen der
  Standardkategorien), keine UI-Texte: `STRIPE_BOOKING_DESCRIPTIONS`,
  editierbar wie jede Buchung.

- **Eine Quelle der Regeln:** Der Buchungs-Service exportiert
  `prepareBooking(input, lookups, existing?)` (Validierung, Normalisierung,
  `calculateBookingAmounts`). `create`/`update` übergeben
  `repositoryBookingLookups(repos)`; der Import übergibt Lookups über
  Daten, die er einmal pro Lauf in seiner Unit of Work lädt (Kategorien,
  Steuerjahre, vorhandene IDs) – kein verschachteltes `run`, keine
  Abfragen je Buchung außer dem Insert.
- **Ergebnis:** `{ ok: true, range, keyMode, created, skipped, failed,
  fees, refunds }` (`fees`/`refunds` je `{ created, skipped, failed }`;
  `failed` je Eintrag `{ kind, externalId, date, amount, currency, code,
  errors? }`) oder `{ ok: false, reason: "invalid" | "noApiKey" |
  "invalidDefaults" | "settingsChanged" | "stripe" }`. Fehlercodes je Eintrag:
  `unsupportedCurrency` (nicht EUR), `zeroAmount`, `amountTooLarge`
  (über `MAX_AMOUNT_CENTS`), `invalidBooking` (mit den Feldfehlern des
  Buchungs-Service). Fehlgeschlagene Einträge werden nicht gebucht; ein
  späterer Import versucht sie erneut. **Übersprungen** heißt: externe ID
  existiert schon (gelöschte Buchungen werden wieder angelegt, #1); manuelle
  Buchungen mit gleicher ID zählen nicht.
- **Letzter Import:** nur bei `ok: true` (auch mit fehlgeschlagenen
  Einträgen), in derselben Transaktion. `lastImportAt` = Uhrzeit des Laufs;
  `lastImportTo` = das spätere von bisherigem Wert und `to` (ein Import eines
  älteren Zeitraums setzt es nicht zurück). `getStatus()` liefert
  `{ lastImportAt, lastImportTo }` (`null`, wenn nie/unlesbar). **#31:**
  Default-Zeitraum `lastImportTo` bis heute – derselbe Tag noch einmal, denn
  später am Tag erstellte Fees fehlen sonst; Doppelte werden übersprungen.
  Ohne bisherigen Import entscheidet #31 (z. B. 1. Januar des Jahres).

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
| `/euer`                 | EÜR-Jahresansicht; Jahr als Search-Param `jahr` (#26)               |
| `/kategorien`           | Kategorienverwaltung                                                |
| `/einstellungen`        | Einstellungen (Steuerjahre, Stripe)                                 |
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
nur Services (`bookings`, `bookingExport`, `categories`, `taxYears`, `euer`, `euerExport`, `stripeSettings`, `stripeImport`), keine Repositories und
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
`useTaxYearList()`) und `euerQueryKeys` (`src/ui/euer/euer-queries.ts`,
`useEuer(year)`, #26) und `stripeQueryKeys` (`src/ui/stripe/stripe-queries.ts`,
`useStripeSettings()`, #28; nur maskierter Schlüssel im Cache) und
`stripeImportQueryKeys` (ebenda, `useStripeImportStatus()`, #31).
Buchungs-Mutationen (`useBookingMutations()`, #18) invalidieren
`bookingQueryKeys.all`, `categoryQueryKeys.all` (`bookingCount`),
`taxYearQueryKeys.all` (`list()` enthält Jahre mit Buchungen) und
`euerQueryKeys.all`. Kategorie- und Steuerjahr-Mutationen invalidieren
ebenfalls `euerQueryKeys.all` (Position/Flag und Steuerstatus wirken
rückwirkend auf die EÜR). Verlässt das
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

| Parameter                | Wert                                                    | `BookingQuery`           |
| ------------------------ | ------------------------------------------------------- | ------------------------ |
| `q`                      | Suchtext (getrimmt)                                     | `text`                   |
| `von`, `bis`             | Zahlungsdatum `YYYY-MM-DD`, inklusive                   | `dateFrom`, `dateTo`     |
| `art`                    | `einnahmen` oder `ausgaben`                             | `type`                   |
| `kategorie`              | Kategorie-IDs (Array, z. B. `[1,7]`)                    | `categoryIds`            |
| `quelle`                 | `manuell` oder `stripe`                                 | `source`                 |
| `ust`                    | USt-Sätze (Array aus `ohne`, `0`, `7`, `19`, `rc`; #26) | `vatRates`               |
| `betragVon`, `betragBis` | Brutto in **Cent**                                      | `amountFrom`, `amountTo` |
| `sortierung`             | `<spalte>-<auf\|ab>` (#23)                              | `sort`                   |
| `seite`                  | Seite ab 2 (#23)                                        | `page`                   |
| `proSeite`               | 25, 100 oder 200 (#23)                                  | `pageSize`               |

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
- **USt-Satz** (#26): Mehrfachauswahl „Ohne USt-Satz“, 0 %, 7 %, 19 %,
  Reverse Charge. Gedacht vor allem für die Drill-down-Links der EÜR (Zeile
  15 = 7 % und 19 %); so sieht und ändert man den Filter. In der URL
  sortiert und ohne Duplikate (`ust=["0","19"]`; Zahlen wie `ust=[19]` werden
  ebenfalls gelesen), unbekannte Werte werden verworfen. SQL:
  `vat_rate IN (…)`, für „ohne“ zusätzlich `OR vat_rate IS NULL`.
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

### EÜR-Jahresansicht (#26)

`src/routes/euer.tsx` (`/euer`) zeigt `services.euer.calculate(year)` (#25)
für das Jahr aus dem Search-Param `jahr` (1000–9999; Standard: aktuelles
Kalenderjahr, steht dann nicht in der URL; Ungültiges wird verworfen). Reine
Logik (URL, Tabellenzeilen, Drill-down- und Hinweis-Links) liegt getestet in
`src/ui/euer/euer-model.ts`, die Darstellung in `euer-view.tsx`.

- **Jahresauswahl** im Seitenkopf: Steuerjahre und Jahre mit Buchungen
  (`useTaxYearList`), das aktuelle und das gewählte Jahr
  (`periodYearOptions`). Darunter der Steuerstatus des Jahres
  (Regelbesteuerung / Kleinunternehmer) mit Link zu den Einstellungen.
- **Tabellen** Betriebseinnahmen und Betriebsausgaben: Zeile, Bezeichnung
  (amtlich aus `describePosition`, ohne Mapping der Anzeigename der
  Position), Betrag (`formatCurrency`, rechtsbündig, `tabular-nums`), je mit
  Summenzeile. Zeile 13 (nachrichtlich) folgt Zeile 12, eingerückt, mit
  „nachrichtlich“ und Betrag in Klammern; sie zählt nicht zur Summe. Bewirtung zeigt
  unter der Bezeichnung Gesamt, „nicht abziehbar“ und „abziehbar“; der
  Betrag der Zeile ist der abziehbare Teil.
- **Ergebnis:** Summe Einnahmen, Summe Ausgaben und Gewinn bzw. Verlust mit
  Wort und Vorzeichen, nicht nur Farbe.
- **Ohne Zeilen-Mapping** für das Jahr: Hinweis „Für {Jahr} gibt es noch
  kein Zeilen-Mapping; angezeigt werden nur die Positionen.“, Zeile „–“.
- **Hinweise** (`EuerWarning`) als Liste mit Text (Paraglide) und, wo der
  Filter sie ausdrücken kann, „Betroffene Buchungen anzeigen“: USt-Satz im
  Kleinunternehmer-Jahr (`ust` = alle Sätze), fehlender Satz im
  regelbesteuerten Jahr (`ust=["ohne"]`), Satz 7/19 % auf Zahlungen an das /
  vom Finanzamt (deren Kategorien + `ust` 7/19), nicht zuordenbare Buchungen
  (deren Kategorien – enthält ggf. auch gezählte Buchungen der anderen Art),
  negative Zeile, Bewirtung und Verpflegungsmehraufwand (die Zeile). Die
  Anzahl im Hinweis zählt nur zuordenbare Buchungen; die verlinkte Liste
  enthält ggf. auch nicht zuordenbare Buchungen (der Filter kann sie nicht
  ausschließen), kann also länger sein.
- **Drill-down:** Die Bezeichnung jeder Position ist ein Link auf
  `/buchungen` mit `von`/`bis` = Jahr, `kategorie` = alle beitragenden
  Kategorien, `ust` = Vereinigung der beitragenden Sätze (entfällt, wenn alle
  fünf beitragen) und `art` nur, wenn alle Beiträge dieselbe Art haben. Der
  Filter verknüpft per UND, kann also „(A und Einnahme) oder (B und
  Ausgabe)“ nicht ausdrücken – die Vereinigung ist trotzdem genau: Im selben
  Jahr landen die Buchungen einer Kategorie mit demselben Satz immer in
  derselben Zeile (Steuerstatus pro Jahr; 15/16 und die USt-Zeilen nach Satz,
  alle übrigen Zeilen mit allen Sätzen ihrer Kategorien), und Kategorien
  haben eine feste Art. Gemischte Zeilen (Umsatz-Kategorien plus deren
  Erlösminderung) bekommen deshalb keinen Art-Filter. Einzige Abweichung:
  Buchungen, deren Art nicht zur Kategorie passt (zählen in der EÜR nicht,
  über die Services nicht erzeugbar). Die Anzahl der Liste entspricht der
  Buchungsanzahl der Zeile; die Summen der Liste sind brutto, die EÜR
  rechnet im regelbesteuerten Jahr netto (Zeile 15 + Zeile 17 = Brutto der
  Liste, wenn keine Erlösminderung beiträgt).
- **Zustände:** Laden, Fehler mit „Erneut versuchen“, leeres Jahr („Für
  {Jahr} gibt es keine Buchungen.“). Ein Jahr ohne Zeilen, aber mit
  Hinweisen (z. B. nur nicht zuordenbare Buchungen), zeigt die Hinweise und
  „Für {Jahr} gibt es keine Positionen in der EÜR.“
- **Barrierefreiheit:** fehlende Zeilennummer sichtbar „–“ (`aria-hidden`)
  plus `sr-only` „ohne Zeile“; die Buchungsanzahl einer Position steht im
  Tooltip und per `aria-describedby` (verstecktes Element, wird nicht doppelt
  vorgelesen) als Beschreibung des Links.

### CSV-Export der EÜR (#27)

„CSV exportieren“ neben der Jahresauswahl (`src/ui/euer/euer-export-button.tsx`)
speichert die EÜR des gezeigten Jahres – gleiches CSV-Format wie der
Buchungsexport (siehe [CSV-Export](#csv-export-24): `toCsv`, `;`, CRLF,
UTF-8 mit BOM, Beträge per `formatAmountPlain` als `csvLiteral`).

**Aufbau** (`euerToCsv(result, labels)` in `src/business/euer/euer-csv.ts`,
rein): Kopfzeile, eine Zeile pro Position, am Ende die Summen.

```csv
Bereich;Zeile;Bezeichnung;Betrag;Nicht abziehbar
Betriebseinnahmen;15;Umsatzsteuerpflichtige Betriebseinnahmen (…);1000,00;
Betriebseinnahmen;17;Vereinnahmte Umsatzsteuer sowie (…);190,00;
Betriebsausgaben;58;Gezahlte und nach § 15 UStG abziehbare Vorsteuerbeträge;19,00;
Betriebsausgaben;64;Bewirtungsaufwendungen;70,00;30,00
Ergebnis;;Summe Betriebseinnahmen;1190,00;
Ergebnis;;Summe Betriebsausgaben;89,00;
Ergebnis;;Gewinn;1101,00;
```

- **Bereich** trennt die Blöcke, damit eine Tabellenkalkulation danach
  filtern oder summieren kann: Betriebseinnahmen, Betriebseinnahmen
  (nachrichtlich), Betriebsausgaben, Ergebnis. Die Summe von `Betrag` über
  „Betriebseinnahmen“ ergibt die Summe der Einnahmen – Zeile 13 hat einen
  eigenen Bereich und zählt nicht doppelt, die Summen stehen unter
  „Ergebnis“.
- **Reihenfolge** wie in der Ansicht: Einnahmen nach Zeile, Zeile 13 direkt
  nach Zeile 12 (`incomeInReportOrder`, gemeinsam mit `euerTables`), dann
  Ausgaben, dann Summe Betriebseinnahmen, Summe Betriebsausgaben und
  Gewinn / Verlust / „Weder Gewinn noch Verlust“ (mit Vorzeichen; ein
  Verlust ist eine negative Zahl).
- **Zeile** leer ohne Zeilen-Mapping; **Bezeichnung** = amtlicher Text des
  Jahres, sonst der Anzeigename der Position.
- **Bewirtung:** `Betrag` = abziehbarer Teil (70 %, zählt in der Summe),
  `Nicht abziehbar` = 30 % – die beiden Spalten des Formulars; nur diese
  Zeile füllt die fünfte Spalte. Gesamt = Betrag + Nicht abziehbar. Eine
  eigene Spalte statt „davon“-Zeilen, damit die Summe über `Betrag` stimmt.
- **Jahr und Steuerstatus** stehen nicht in der Datei (kein Metablock vor der
  Kopfzeile – die Datei bleibt eine einfache Tabelle): das Jahr steht im
  Dateinamen, der Status ergibt sich aus den Zeilen (12 bzw. 15/16).
- **Texte** (Kopfzeile, Bereiche, Summen, Anzeigenamen) übergibt die UI
  (`euerCsvLabels()` in `src/ui/euer/euer-messages.ts`); die amtlichen
  Bezeichnungen kommen als Formulardaten aus dem Ergebnis.
- **Dateiname** `yearCsvFileName(base, year)`: `euer-2025.csv` (`euer` aus
  Paraglide). Dialogfilter wie beim Buchungsexport.
- **Service** `createEuerExportService({ euer, fileSaver })` (`AppServices.euerExport`),
  `exportCsv({ year, labels, fileNameBase, filterName })`: berechnet vor dem
  Dialog (`EuerService.calculate`), speichert über den `FileSaver`. Ergebnis
  `{ ok: true, saved: true, fileName, year }`, `{ ok: true, saved: false }`
  (Abbruch) oder `{ ok: false, reason: "invalid", errors }` (ungültiges
  Jahr, ohne Dialog); Rechen-/Schreibfehler werfen. Keine neuen
  Capabilities.
- **Button:** deaktiviert (fokussierbar, Grund im Tooltip), solange die EÜR
  lädt oder nicht berechnet werden konnte, für ein Jahr ohne Zeilen (nichts
  zu exportieren) und während ein Export läuft (Spinner, „Exportiere …“).
  Die Daten kommen aus derselben Abfrage wie die Tabelle (gleicher
  Query-Key). Erfolg: Toast „EÜR {Jahr} in {Datei}“; Abbruch: kein Toast;
  Fehler: Fehler-Toast, Details in der Konsole.

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
- **USt-Kategorien des Finanzamts:** Wählt der Nutzer eine Kategorie mit
  `UST_AN_FA` oder `UST_ERSTATTUNG` (`isTaxOfficePayment`), setzt das
  Formular den USt-Satz auf `0` und zeigt (regelbesteuert) einen Hinweis;
  der Satz bleibt änderbar, der Service prüft unverändert. Die EÜR zählt
  solche Buchungen ohnehin brutto (#25).
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
Abschnitt „Stripe“ (#28) folgt als weiterer `SettingsSection` darunter,
danach „Datensicherung“ ([#32](#datensicherung-32)).

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

**Stripe** (`src/ui/stripe/stripe-settings-section.tsx`, `StripeSettingsSection`; reine Logik getestet in
`stripe-settings-model.ts`, Texte in `stripe-messages.ts`, Hooks in
`stripe-queries.ts`/`stripe-mutations.ts`):

- **API-Schlüssel:** Hinweis zur benötigten Berechtigung („Application
  fees: Lesen“) und wo der Schlüssel angelegt wird. Ohne Schlüssel ein
  Passwortfeld (`autocomplete="off"`, ohne Rechtschreibprüfung) mit
  Client-Prüfung per `validateStripeApiKey`; mit Schlüssel die maskierte
  Form, Modus (Live/Test), „Ändern“ (Feld plus „Abbrechen“) und „Entfernen“
  (Alert-Dialog, Fokus auf „Abbrechen“; die Standardwerte bleiben).
- **Standardwerte:** USt-Satz und zwei Kategorie-Selects (Fees: Einnahme
  ohne Finanzamt-Kategorie;
  Refunds: Ausgabe mit „mindert Einnahmen“; ohne archivierte außer der
  gespeicherten und der gewählten, markiert). Ohne gespeicherte Werte sind die Vorschläge
  vorgewählt und ein Hinweis sagt „noch nicht gespeichert“; sind
  gespeicherte Werte inzwischen ungültig, listet ein Hinweis die Probleme.
  Service-Fehler erscheinen am Feld.
- **Verbindung testen** (#29, nur mit gespeichertem Schlüssel):
  `stripeSettings.testConnection()` als `useMutation` (keine Variablen, kein
  Schlüssel im Cache); das Ergebnis steht als `role="status"` unter dem
  Button (Texte `testConnectionMessage`/`stripeClientErrorMessage`). Ein neuer
  Schlüssel setzt es zurück.
- **Invalidierung:** nur `stripeQueryKeys.all`. Die Kategorien kommen aus
  `useCategoryList()`; Gültigkeit und Vorschläge werden in der UI aus der
  aktuellen Kategorienliste berechnet (`validateStripeDefaults`,
  `suggestStripeDefaults`) – Kategorie-Mutationen müssen die Stripe-Keys
  daher nicht invalidieren.

### Stripe-Import-Dialog (#31)

„Stripe importieren“ im Kopf der Buchungsliste (neben „CSV exportieren“)
öffnet einen Dialog (`src/ui/stripe/stripe-import-dialog.tsx`). Reine Logik
(Default-Zeitraum, Client-Prüfungen, Ergebnis → Zusammenfassung, Beträge
fremder Währungen, Link-Filter) liegt getestet in `stripe-import-model.ts`,
Texte zu Codes in `stripe-messages.ts`.

Beträge fremder Währungen (nur in der Liste der nicht gebuchten Einträge)
rechnet `stripeCurrencyDecimals` mit **Stripes** Nachkommastellen um, nicht
mit denen von CLDR/`Intl`: null Stellen nur für Stripes Zero-Decimal-Liste
(`bif clp djf gnf jpy kmf krw mga pyg rwf ugx vnd vuv xaf xof xpf`), drei für
`bhd jod kwd omr tnd`, sonst zwei – auch für HUF, ISK, IDR oder COP, die
CLDR ohne Nachkommastellen führt, Stripe aber ×100 sendet.

- **Voraussetzungen:** Ohne Schlüssel (`useStripeSettings().apiKey === null`)
  oder mit fehlenden/ungültigen Standardwerten (`validateStripeDefaults`
  gegen die aktuelle Kategorienliste) zeigt der Dialog nur einen Hinweis und
  „Zu den Einstellungen“, kein Formular.
- **Test-Schlüssel** (`mode: "test"`): Warnung, dass Test-Fees als echte
  Buchungen in Buchhaltung und EÜR landen, plus Pflicht-Checkbox „trotzdem
  importieren“ (Client-Prüfung wie ein Feld). Bewusst kein Verbot: zum
  Ausprobieren nützlich; die Buchungen lassen sich über Quelle Stripe finden
  und löschen. Die Zusammenfassung wiederholt den Hinweis (`keyMode` des
  Ergebnisses).
- **Zeitraum:** zwei Datumsfelder (TanStack Form, gleiches
  Validierungsmuster wie die anderen Formulare). Default
  `defaultImportPeriod(status, heute)`: von `lastImportTo` (derselbe Tag
  noch einmal), ohne bisherigen Import vom 1. Januar des laufenden Jahres,
  bis heute; „heute“ ist der Kalendertag in Europe/Berlin
  (`berlinTodayIsoDate`), wie die Prüfung `inFuture` des Service. Ein
  gespeichertes Ende nach heute (Uhr zurückgestellt) beginnt heute. Darüber
  „Letzter Import: TT.MM.JJJJ, HH:MM (bis TT.MM.JJJJ)“. Client-Prüfungen
  spiegeln den Service (`required`, `invalidDate`, `inFuture` vor
  `beforeFrom`); dessen Feldfehler erscheinen als `onServer` am Feld.
- **Ablauf:** `useStripeImport()` (`useMutation`, Variablen nur der
  Zeitraum). Während des Imports ist der Dialog nicht schließbar (kein
  Schließen-Button, Escape/Klick daneben ignoriert, `aria-busy`), der Button
  zeigt Spinner und „Importiere …“ und behält den Fokus – der Import ist
  alles oder nichts und nicht abbrechbar.
- **Ergebnis:** „X neu, Y übersprungen“ (ggf. „, Z nicht gebucht“), darunter
  je Fees/Rückerstattungen, dann eine Tabelle der nicht gebuchten Einträge
  (Art, Stripe-ID, Datum, Betrag in ihrer Währung, Grund; bei
  `invalidBooking` die Feldfehler des Buchungs-Service). „Buchungen
  anzeigen“ führt zur Liste mit `von`/`bis` = Zeitraum und `quelle=stripe`.
  Der Fokus springt auf die Überschrift des Ergebnisses; eine stets
  vorhandene `role="status"`-Region kündigt Fortschritt und Ergebnis an.
- **Fehler:** `noApiKey`/`invalidDefaults` → Hinweis mit Link zu den
  Einstellungen (Einstellungen und bei `invalidDefaults` auch die Kategorien
  werden neu geladen; der Dialog wechselt dann auf den Hinweis, der den Fokus
  übernimmt), `stripe` → `stripeClientErrorMessage`,
  `settingsChanged` → „erneut importieren“; unerwartete Fehler → Toast und
  Meldung (nichts gebucht). Meldungen als `role="alert"`, fokussiert.
- **Invalidierung** nach Erfolg: `bookingQueryKeys.all`,
  `categoryQueryKeys.all` (`bookingCount`), `taxYearQueryKeys.all` (Jahre mit
  Buchungen), `euerQueryKeys.all` und `stripeImportQueryKeys.all` (Status →
  nächster Default-Zeitraum); nach `noApiKey`/`invalidDefaults`/
  `settingsChanged` `stripeQueryKeys.all`, nach `invalidDefaults` zusätzlich
  `categoryQueryKeys.all` (die Gültigkeit der Standardwerte prüft die UI
  gegen die Kategorienliste).
- **„Heute“** wird beim Öffnen festgelegt und gilt, solange der Dialog offen
  ist (Höchstwert der Datumsfelder, Client-Prüfung `inFuture`); maßgeblich
  ist die Prüfung des Service zum Zeitpunkt des Imports.

### Datensicherung (#32)

„Backup erstellen“ im Abschnitt **Datensicherung** auf `/einstellungen`
(`src/ui/backup/backup-section.tsx`, `BackupSection`; Hook
`useCreateBackup` in `backup-mutations.ts`) speichert eine Kopie der ganzen
Datenbank an einen per Speicherdialog gewählten Ort. Wiederherstellen ist
manuell ([Datenmodell](data-model.md#backup-und-wiederherstellung-32)).

| Datei                                     | Aufgabe                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/business/backup/backup-service.ts`   | `createBackupService({ savePathPicker, databaseBackup, clock })`, Port `DatabaseBackup` |
| `src/business/backup/backup-target.ts`    | Schutz: `isInDatabaseFolder`, `BackupTargetInDatabaseFolderError`, `BackupWriteError`   |
| `src/business/backup/backup-file-name.ts` | Dateinamenvorschlag `belegwerk-backup-YYYY-MM-DD_HHMM.db` (Europe/Berlin)               |
| `src/business/files.ts`                   | Port `SavePathPicker` (`pickSavePath` → Pfad oder `null`), `safeFileNamePart`           |
| `src/persistence/backup.ts`               | `writeDatabaseBackup(connection, path)`: `VACUUM INTO ?` + Prüfung; `Database.backupTo` |
| `src/app/tauri-file-saver.ts`             | `createTauriSavePathPicker()`: nur der Speicherdialog                                   |
| `src/app/tauri-database-backup.ts`        | `createTauriDatabaseBackup(database)`: Zieldatei leeren, dann `database.backupTo(path)` |

- **Ablauf** (`backup.createBackup({ fileNameBase, filterName })`):
  Speicherdialog mit Vorschlag `belegwerk-backup-2026-11-14_1530.db` (Datum
  und Uhrzeit in Europe/Berlin, Filter „SQLite-Datenbank“, `*.db`) →
  Abbruch: `{ saved: false }`, nichts geschrieben → sonst Backup schreiben,
  `{ saved: true, fileName, path }`. Fehler werfen.
- **`VACUUM INTO ?`** schreibt SQLite selbst: eine transaktionskonsistente,
  kompaktierte Kopie in einer Datei (Journal-Modus der Kopie `DELETE`). Der
  Pfad ist ein **gebundener Parameter**, nie Teil des SQL-Texts (Leerzeichen,
  Umlaute, `'` im Pfad sind unproblematisch). `VACUUM` darf nicht in einer
  Transaktion laufen; es läuft daher in einem `SqlConnection.exclusive`-
  Abschnitt – eine laufende Transaktion wird erst beendet, kein anderer Flow
  kommt dazwischen.
- **Prüfung danach** (im selben `exclusive`-Abschnitt): Die Kopie wird als
  `backup_check` angehängt (`ATTACH DATABASE ? AS backup_check`);
  `PRAGMA backup_check.quick_check` muss genau `ok` liefern und die Kopie so
  viele Einträge in `sqlite_schema` haben wie die Quelle (eine leere Datei
  bestünde `quick_check`). Danach `DETACH` – auch nach einem Fehler.
  Fehlschlag: `BackupCheckError`. Defensiv: vor `VACUUM` ein stilles
  `ROLLBACK` (falls doch eine Transaktion offen geblieben ist), vor `ATTACH`
  ein stilles `DETACH` (falls `backup_check` noch angehängt ist).
- **Nie in den Datenordner der App (Schutz vor Datenverlust).** Vor jedem
  Schreibzugriff prüft `createTauriDatabaseBackup`, ob das Ziel im Ordner der
  laufenden Datenbank liegt (`Database.mainFilePath()` = `PRAGMA
  database_list`, Zeile `main`; Vergleich mit `isInDatabaseFolder` aus
  `src/business/backup/backup-target.ts`). Der Ordner und alles darunter wird
  abgelehnt – also `belegwerk.db` selbst, `-journal`/`-wal`/`-shm` und jede
  andere Datei dort. Ohne diese Prüfung würde das Leeren (nächster Punkt) die
  laufende Datenbank auf 0 Byte kürzen (SQLite öffnet sie mit
  Schreib-Freigabe, das Kürzen gelingt), und das folgende `VACUUM INTO`
  schlüge fehl: alle Daten weg. Abgelehnt wird mit
  `BackupTargetInDatabaseFolderError`; der Service liefert
  `{ saved: false, reason: "targetInDatabaseFolder" }`, die UI zeigt „Das
  Backup kann nicht im Datenordner der App gespeichert werden – bitte einen
  anderen Ort wählen.“ Ist der Pfad der Datenbank unbekannt (leer, nur bei
  einer In-Memory-DB), wird gar nicht geschrieben.
  - **Vergleich:** Pfade werden normalisiert (`/` → `\`, Präfixe `\\?\`,
    `\\.\` und `\??\` – auch vor `UNC\` –, doppelte Trenner, `.`/`..`,
    abschließende Trenner, Punkte und Leerzeichen am Ende jedes Segments –
    Win32 ignoriert sie, `de.belegwerk.desktop.\belegwerk.db` ist die echte
    Datei –, Groß-/Kleinschreibung).
    Da der ganze Ordner gesperrt ist, sind auch 8.3-Kurznamen der _Datei_
    abgedeckt.
  - **Bekannte Grenzen:** Symbolische Links, Junctions, Hardlinks,
    zugeordnete Laufwerke/`subst`, UNC-Pfade auf den eigenen Rechner
    (`\\localhost\C$\…`, `\\<rechnername>\…`) und 8.3-Kurznamen des _Ordners_
    werden nicht aufgelöst (das WebView kann Pfade nicht kanonisieren). Ein Weg über
    einen solchen Alias auf `belegwerk.db` würde nicht erkannt.
- **Vorhandene Zieldatei:** `VACUUM INTO` verweigert eine vorhandene,
  nicht leere Datei („output file already exists“), eine **leere** nimmt es
  an. Der Dialog erlaubt das Überschreiben (er fragt vorher). Deshalb leert
  `createTauriDatabaseBackup` die gewählte Datei – nach der Prüfung oben –
  mit `writeTextFile(path, "")` (legt sie an bzw. kürzt sie auf 0 Byte) und
  lässt dann SQLite hineinschreiben. Schlägt das Backup fehl, wird die Datei
  erneut geleert (best effort): Eine leere Datei ist erkennbar kein Backup,
  eine halb geschriebene könnte für eines gehalten werden. Eine vorher
  vorhandene Datei ist in diesem Fall verloren – der Nutzer hatte dem
  Ersetzen zugestimmt. Fehler kommen als `BackupWriteError` mit
  `targetCleared` (ob die Zieldatei schon geleert war); die UI ergänzt dann
  „Die Zieldatei wurde geleert.“
- **Berechtigungen: keine neuen.** Das Schreiben durch SQLite läuft im
  Rust-Prozess (`tauri-plugin-sql`) und unterliegt nicht dem fs-Scope. Für
  das Leeren genügt `fs:allow-write-text-file` (wie beim CSV-Export), der
  Dialog trägt genau den gewählten Pfad in den Scope ein. Verworfen:
  temporäre Datei + `rename`/`copy-file` (bräuchte `fs:allow-rename`/
  `fs:allow-copy-file` plus einen statischen Scope für die temporäre Datei,
  denn der Dialog erlaubt nur den gewählten Pfad) und Löschen per
  `fs:allow-remove` (zusätzliche Berechtigung, gleiches Ergebnis wie Leeren).
  Rust bleibt reine Plugin-Konfiguration.
- **Inhalt:** alle Tabellen inkl. `settings` – also auch der Stripe-Schlüssel
  im Klartext; die Beschreibung des Abschnitts weist darauf hin.
- **UI:** Button „Backup erstellen“ (während des Laufs deaktiviert, aber
  fokussierbar, mit Spinner), Erfolg: Toast mit Dateiname; Abbruch: nichts;
  Ziel im Datenordner: eigener Fehler-Toast (nichts geschrieben); sonstige
  Fehler: Fehler-Toast, ggf. mit „Die Zieldatei wurde geleert.“ (Details in
  der Konsole). Darüber Speicherort der DB
  und ein Kurzhinweis zur Wiederherstellung. Es werden keine Daten
  geändert, also nichts invalidiert.

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
(`pnpm tauri build --no-bundle`). Der Stripe-Client (#29) braucht keine
Erweiterung: `tauri-plugin-http` führt die Anfrage in Rust aus, die WebView
spricht nur über die IPC. Braucht ein späteres Feature echte Netzwerkziele
der WebView, wird die CSP gezielt erweitert.

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
