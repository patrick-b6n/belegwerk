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
  ist das Sicherheitsnetz. CHECK-Verletzungen werden nicht übersetzt – sie
  bedeuten einen Validierungsfehler im Service.
- **Erweiterung:** Die Suche (#21) kommt als eigene Methode mit Query-Objekt
  (`search(query)`) an `BookingRepository`; EÜR-Summen (#25) ebenso.

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
Implementierungen (IDs ohne Wiederverwendung, Rückgabewerte, Constraint-Fehler,
Rollback). Es läuft in `src/business/__tests__/in-memory-repositories.test.ts`
gegen die Fakes und in `src/persistence/repositories/repositories.test.ts`
gegen Drizzle auf `better-sqlite3` – so können die Fakes nicht vom echten
Verhalten abweichen, und jede Repository-Abfrage läuft durch den Test-Client,
der doppelte Ergebnis-Spaltennamen ablehnt. Neue Repository-Methoden bekommen
ihre Fälle im Vertrag. Nicht nachgebildet werden in den Fakes nur die
CHECK-Constraints der DB.

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

## App-Shell & Routen

| Route            | Bereich                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `/`              | Weiterleitung auf `/buchungen` (Startseite)                         |
| `/buchungen`     | Buchungsliste; Filter/Sortierung/Seite als Search-Params (#22, #23) |
| `/euer`          | EÜR-Jahresansicht                                                   |
| `/kategorien`    | Kategorienverwaltung                                                |
| `/einstellungen` | Einstellungen (Steuerjahre, später Stripe)                          |
| alles andere     | `notFoundComponent` der Root-Route, innerhalb der Shell             |

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
Migrationen anwenden ([Datenmodell](data-model.md)), Repositories und Services
erzeugen (`createAppServices`, `src/app/services.ts`). Bis es Services gibt
(#14 ff.), stellt `AppServices` `repositories` und `unitOfWork` als
Business-Interfaces bereit. Bis dahin zeigt er einen
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
- Services werden (noch) nicht als Router-Context an Loader gegeben; braucht
  ein Loader sie, kommt das mit der ersten Route, die Daten lädt.

### TanStack Query

`src/app/query-client.ts` erzeugt den `QueryClient` (Composition Root:
Defaults wie `retry: false` sind App-Konfiguration, kein UI-Detail).
`src/router.tsx` legt pro Router-Instanz einen Client an, stellt ihn über
`Wrap` per `QueryClientProvider` bereit und gibt ihn als Router-Context
(`context.queryClient`) an Loader weiter.

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
