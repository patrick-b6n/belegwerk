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
| `src/app`         | Composition Root: erzeugt DB, Repositories und Services und stellt sie der UI bereit (#10).                                       |

Generiert und von Lint/Format ausgenommen: `src/routeTree.gen.ts` (TanStack
Router) und `src/paraglide/` (Paraglide, git-ignoriert).

## Import-Regeln

| Layer                  | darf nicht importieren aus                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui`, `src/routes` | `src/persistence`                                                                                                                                                                                                                                                                   |
| `src/business`         | `src/persistence`, `src/ui`, `src/routes`, `src/app`, `src/router.tsx`, `src/routeTree.gen.ts`, `src/paraglide`, React-Paketen (`react`, `react-dom`, `@tanstack/react-*`, `@base-ui/react`, …), `@tauri-apps/*`, `drizzle-orm`, `drizzle-kit`, `better-sqlite3`; außerdem kein JSX |
| `src/persistence`      | `src/ui`, `src/routes`, `src/app`, `src/router.tsx`, `src/routeTree.gen.ts`, React-Paketen                                                                                                                                                                                          |
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

### Plattformzugriffe

Business ist frei von Tauri. Braucht Logik Plattformfunktionen (HTTP für
Stripe, Dateien für CSV), definiert Business ein Interface; die Implementierung
mit `@tauri-apps/*` liegt außerhalb von `src/business` und wird in `src/app`
verdrahtet. Ebenso sind `drizzle-orm`, `drizzle-kit` und `better-sqlite3` in
Business verboten – Drizzle gibt es nur in `src/persistence`.

## Lint & Format

| Script              | Zweck                            |
| ------------------- | -------------------------------- |
| `pnpm lint`         | oxlint (inkl. Layer-Grenzen)     |
| `pnpm format`       | oxfmt, formatiert alle Dateien   |
| `pnpm format:check` | oxfmt im Prüfmodus (für CI, #7)  |
| `pnpm typecheck`    | Paraglide kompilieren + `tsc -b` |

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
  `vitest.config.ts`), mit Node-Typen.
- `tsconfig.json` – nur Referenzen auf alle drei; `tsc -b` prüft alle.

## Tests

Vitest in der Node-Umgebung; Business mit In-Memory-Fakes, Persistence gegen
`better-sqlite3`. Konventionen: [docs/testing.md](testing.md).
