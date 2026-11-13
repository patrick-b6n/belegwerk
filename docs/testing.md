# Tests

Tests laufen mit **Vitest** in der **Node-Umgebung**
([`vitest.config.ts`](../vitest.config.ts)).

| Script            | Zweck                                       |
| ----------------- | ------------------------------------------- |
| `pnpm test`       | alle Tests einmal ausführen (für CI, #7)    |
| `pnpm test:watch` | Watch-Modus: führt betroffene Tests neu aus |

Einzelne Dateien oder Testnamen: `pnpm test src/business/format` bzw.
`pnpm test -t "parseAmount"`.

## Ablage und Benennung

- Tests liegen **neben dem Code** als `<datei>.test.ts`, z. B.
  `src/business/format/currency.ts` → `currency.test.ts`. Vitest sammelt
  `src/**/*.test.{ts,tsx}`.
- **Test-Hilfen**, die selbst keine Tests sind (Fakes, Fixtures,
  DB-Helfer), liegen in einem Ordner `__tests__/` im jeweiligen Layer, z. B.
  `src/business/__tests__/` oder `src/persistence/__tests__/`. So gelten für
  sie dieselben Layer-Grenzen wie für den Code daneben.
- Unter `src/routes` werden `*.test.ts[x]` und `__tests__/` vom Router
  ignoriert (`routeFileIgnorePattern` in `vite.config.ts`), Tests können also
  auch dort neben den Routen liegen.
- Produktivcode importiert **nie** aus `*.test.ts` oder `__tests__/`.
- APIs explizit importieren (`import { describe, expect, it } from "vitest"`),
  keine Globals.

## Layer

- **Business** (`src/business`): reine Unit-Tests. Repositories und
  Plattformzugriffe werden durch **In-Memory-Fakes** der Interfaces ersetzt
  (#11). Die Lint-Regeln von Business gelten auch für Tests – kein Drizzle,
  kein `better-sqlite3`, kein React/Tauri.
- **Persistence** (`src/persistence`): Tests gegen **`better-sqlite3`** mit
  demselben Drizzle-Schema und denselben Migrationen wie die App (#11):
  `createTestDb()` aus `src/persistence/__tests__/test-db.ts` liefert pro Test
  eine frische In-Memory-Datenbank mit allen Migrationen
  ([Datenmodell](data-model.md)).
- **UI**: derzeit keine Tests. Bräuchten DOM-Tests später eine Umgebung wie
  `jsdom`, kann sie pro Datei per `// @vitest-environment jsdom` gesetzt
  werden.

## TypeScript

Testcode läuft in Node, die App im WebView. Deshalb gibt es ein eigenes
Projekt [`tsconfig.test.json`](../tsconfig.test.json):

- erfasst `src/**/*.test.ts`, `src/**/*.test.tsx` und `src/**/__tests__/`,
- erbt alle Optionen von `tsconfig.app.json` (inkl. `@/*`-Alias),
- hat zusätzlich **Node-Typen** (`node:fs`, `process`, `better-sqlite3`, …).

`tsconfig.app.json` schließt genau diese Dateien aus, damit Node-Typen nicht
in den WebView-Code durchsickern: `process` oder `node:*` in normalem Code
unter `src/` bleibt ein Typfehler. `pnpm typecheck` prüft alle Projekte.

## Zeitzone

Die Tests laufen in `Pacific/Pago_Pago` (UTC−11, ohne Sommerzeit), gesetzt
in `vitest.config.ts`. Code, der versehentlich in lokaler Zeit rechnet,
fällt so auch auf UTC-Runnern auf. Ein Test in
`src/business/format/date.test.ts` stellt sicher, dass die Einstellung greift.

## Coverage

Bewusst noch nicht eingerichtet (bräuchte `@vitest/coverage-v8`). Bei Bedarf
nachrüsten.
