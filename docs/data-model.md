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

### Laden im WebView (#10)

Der Migrator der App kann das Dateisystem nicht lesen. Die Migrationen werden
daher von Vite gebündelt:

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

### Hinweise für #10/#11

- **Fremdschlüssel** prüft SQLite nur mit `PRAGMA foreign_keys = ON`, und das
  gilt pro Verbindung. `tauri-plugin-sql` (sqlx) aktiviert es standardmäßig;
  der Migrator muss es trotzdem explizit setzen (siehe Protokoll).
- **Migrator-Protokoll (#10).** Ändert eine Migration eine Tabelle, die
  SQLite nicht per `ALTER TABLE` ändern kann, baut drizzle-kit sie neu auf
  (`__new_<tabelle>` anlegen, kopieren, alte löschen, umbenennen) und schreibt
  `PRAGMA foreign_keys=OFF` davor. **Innerhalb einer Transaktion ignoriert
  SQLite dieses Pragma** – bei einer Elterntabelle wie `categories` schlüge das
  `DROP TABLE` dann fehl bzw. würde kaskadieren. Deshalb:
  1. `PRAGMA foreign_keys = OFF` (außerhalb jeder Transaktion),
  2. `BEGIN`, alle ausstehenden Migrationen ausführen und protokollieren,
  3. `PRAGMA foreign_key_check` – liefert es Zeilen: `ROLLBACK` und Fehler,
  4. `COMMIT`,
  5. `PRAGMA foreign_keys = ON` (auch nach einem Fehler).
- **Verbindungs-Pool:** `tauri-plugin-sql` nutzt einen sqlx-Pool. Einzelne
  `execute`-Aufrufe für `PRAGMA`, `BEGIN`, Migrationen und `COMMIT` können auf
  verschiedenen Verbindungen landen – dann wirkt weder die Transaktion noch das
  Pragma. #10 muss das lösen, z. B. Pool auf eine Verbindung begrenzen oder die
  Migration in einem einzigen Aufruf ausführen; Gleiches gilt für
  Transaktionen der Repositories.
- **`onConflictDoNothing` (Stripe-Import, #30):** Drizzle 0.45 erzeugt mit
  `onConflictDoNothing({ target, where })` für den partiellen Index
  ungültiges SQL. Stattdessen das nackte `.onConflictDoNothing()` verwenden
  (greift bei jedem Unique-Konflikt) oder vorhandene `external_id`s vorher
  abfragen.
- Die Tests nutzen `createTestDb()` aus
  [`src/persistence/__tests__/test-db.ts`](../src/persistence/__tests__/test-db.ts):
  `better-sqlite3` in-memory mit Drizzles Migrator auf denselben Dateien,
  nach obigem Protokoll (Fremdschlüssel aus, migrieren, prüfen, an).
  Sobald der eigene Migrator existiert (#10), sollte der Helfer ihn verwenden,
  damit Tests genau den App-Pfad abdecken.
