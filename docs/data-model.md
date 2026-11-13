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
| `settings`   | `key` (PK), `value`                                                                                                                                                                                              |

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
| EÜR-Position      | `euer_position` ist ein stabiler Schlüssel (`TEXT`, z. B. `BETRIEBSEINNAHMEN_UST_PFLICHTIG`) ohne CHECK – die Liste der Positionen lebt im Code (#13) und darf wachsen, ohne dass eine Migration nötig ist.                                                                                                                                                                              |
| Steuerjahre       | `year` (`INTEGER`, 1000–9999) ist der Primärschlüssel.                                                                                                                                                                                                                                                                                                                                   |
| Duplikatschutz    | Partieller Unique-Index auf `(source, external_id) WHERE external_id IS NOT NULL`: Manuelle Buchungen ohne externe ID kollidieren nie; gelöschte Stripe-Buchungen können erneut importiert werden.                                                                                                                                                                                       |
| Spalten in CHECKs | Im Schema über `col(...)` unqualifiziert (`"date"` statt `"bookings"."date"`). Baut drizzle-kit eine Tabelle in einer späteren Migration als `__new_<tabelle>` neu auf, übernimmt es den Constraint-Text; ein Verweis auf `"bookings"` schlüge dort fehl.                                                                                                                                |

`STRICT`-Tabellen unterstützt drizzle-kit nicht; ohne die `typeof`-CHECKs
würde SQLite z. B. `1.5` in einer `INTEGER`-Spalte speichern. Text wie `'100'`
wandelt die Typ-Affinität der Spalte schon vor dem CHECK in die Zahl `100` um;
er wird daher als ganze Cent akzeptiert (siehe Test).

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
  kein `-wal`) – einfach für Backups (M7).
- **WebView-Reload:** Die Verbindung lebt im Host weiter. `openDatabase` rollt
  deshalb eine evtl. offen gebliebene Transaktion zurück.

Geprüft in der laufenden App (#10): Eine `TEMP`-Tabelle ist nur auf der
Verbindung sichtbar, die sie angelegt hat. 40 parallele Abfragen darauf
gelingen mit dem eigenen Pool alle; mit einem per `load` geöffneten
Standard-Pool schlugen 28 von 40 fehl (`no such table`). Ebenso bleibt
`PRAGMA foreign_keys = OFF` über Aufrufe hinweg erhalten.

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
  Transaktion (Deadlock).
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
5. `PRAGMA foreign_keys = ON` (auch nach einem Fehler).

### Hinweise für #11 ff.

- Repositories bauen auf `Database` (`db` für Abfragen, `transaction` für
  zusammengehörige Schreibvorgänge) und werden in `createAppServices`
  (`src/app/services.ts`) erzeugt; UI und Routen erhalten nur Services
  (`useAppServices()`).
- **`onConflictDoNothing` (Stripe-Import, #30):** Drizzle 0.45 erzeugt mit
  `onConflictDoNothing({ target, where })` für den partiellen Index
  ungültiges SQL. Stattdessen das nackte `.onConflictDoNothing()` verwenden
  (greift bei jedem Unique-Konflikt) oder vorhandene `external_id`s vorher
  abfragen.
- Tests nutzen `createTestDb()` aus
  [`src/persistence/__tests__/test-db.ts`](../src/persistence/__tests__/test-db.ts):
  `better-sqlite3` in-memory hinter demselben `openDatabase` wie die App
  (Migrator, Proxy-Adapter, `SqlConnection`) – nur das Plugin ist ersetzt.
