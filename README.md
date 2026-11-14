# Belegwerk

Belegwerk ist eine lokale Desktop-App für Windows zum Erfassen von Einnahmen und
Ausgaben eines Betriebs und zum Erstellen der **Einnahmenüberschussrechnung
(Anlage EÜR)** für die Steuererklärung. Alle Daten liegen in einer SQLite-Datei
auf dem eigenen Rechner; es gibt kein Konto, keinen Server und keine Cloud.
Einzige Verbindung nach außen ist der optionale Import von Stripe Application
Fees.

## Funktionsumfang

- **Buchungen** erfassen, bearbeiten und löschen: Datum (Zahlungsdatum, bestimmt
  das EÜR-Jahr), Einnahme/Ausgabe, Bruttobetrag in EUR, USt-Satz (0 / 7 / 19 %
  oder Reverse Charge; Netto und USt werden berechnet), Kategorie,
  Beschreibung, Gegenpartei, optional Referenz und Notiz.
- **Kategorien** – vorbefüllt und erweiterbar, jede einer EÜR-Position
  zugeordnet; „mindert Einnahmen“ für Rückerstattungen; Kategorien mit
  Buchungen werden archiviert statt gelöscht.
- **Kleinunternehmer (§ 19 UStG)** als Einstellung pro Steuerjahr.
- **Suche, Filter, Sortierung und Summen** in der Buchungsliste (Zeitraum,
  Art, Kategorie, Quelle, USt-Satz, Betrag); der Zustand steht in der URL.
- **CSV-Export** der gefilterten Buchungen und der EÜR (Semikolon,
  Dezimalkomma, `TT.MM.JJJJ`, UTF-8 mit BOM – direkt in Excel lesbar).
- **EÜR-Jahresansicht** mit Zeilennummern und amtlichen Bezeichnungen der
  Anlage EÜR, USt/Vorsteuer automatisch, Gewinn bzw. Verlust, Hinweisen zu
  auffälligen Buchungen und **Drill-down** von jeder Zeile zu den
  zugehörigen Buchungen.
- **Stripe-Import** von Application Fees und deren Rückerstattungen als
  reguläre Buchungen, mit Duplikatschutz ([Stripe einrichten](#stripe-einrichten)).
- **Backup** der ganzen Datenbank per Knopfdruck ([Datensicherung](#datensicherung)).

**Nicht im Umfang:** Belege/Anhänge, GoBD-Festschreibung bzw. Audit-Log,
AfA/Anlageverzeichnis, Fremdwährungen (nur EUR), PDF-Ausgabe und
ELSTER-Übermittlung. Es gibt genau einen Betrieb und eine EÜR pro
Kalenderjahr.

> **Keine Steuerberatung.** Belegwerk rechnet nach festen Regeln
> ([Datenmodell](docs/data-model.md#eür-berechnung-25)); die Ergebnisse sind vor
> der Übernahme in die Steuererklärung zu prüfen. Bekannte Grenzen u. a.:
>
> - **Bewirtung:** Die App teilt pauschal 70 % abziehbar / 30 % nicht
>   abziehbar auf; Angemessenheit und Nachweis prüft sie nicht.
> - **Verpflegungsmehraufwand:** Die App kennt keine Pauschalen und zählt die
>   Beträge wie erfasst – nur die Pauschale buchen.
> - **Zeile 13** (Kleinunternehmer, nachrichtlich) ist eine Näherung aus den
>   Kategorien für steuerfreie/nicht steuerbare Erlöse.
> - **Zeilennummern** der Anlage EÜR sind nur für 2025 und 2026 hinterlegt
>   (2026 vorläufig); für andere Jahre zeigt die App die Namen der Positionen.

## Installation

Belegwerk ist eine **einzelne `.exe`** ohne Installer und ohne
Code-Signierung. Bezugsquellen:

- **GitHub-Releases** (`belegwerk-<version>.exe` samt `.sha256`), entstehen
  automatisch bei jedem Push auf `main`
  ([Release](docs/release.md#release-veröffentlichen-71-74)). Die Version ist
  Datum und Uhrzeit des Releases in UTC, z. B. `2026-11-14-2000`
  ([Versionsschema](docs/release.md#versionsschema-71)).
- **Selbst bauen** mit `pnpm release` (siehe [Entwicklung](#entwicklung) und
  [Release](docs/release.md)); legt `release/belegwerk-<version>.exe` samt
  `.sha256` an. Lokale Builds werden nicht veröffentlicht.
- **Artefakt eines CI-Laufs** (nur zum Ausprobieren, 7 Tage aufbewahrt, siehe
  [CI](#ci)).

- **Starten:** Die `.exe` an einen beliebigen Ort legen und starten; sie
  braucht keine weiteren Dateien. Am besten in `belegwerk.exe` umbenennen:
  Das Auto-Update behält den Dateinamen bei, sonst trüge die Datei nach
  Updates weiter die alte Versionsnummer im Namen.
- **SmartScreen:** Da die `.exe` nicht signiert ist, meldet Windows nach dem
  Herunterladen „Der Computer wurde durch Windows geschützt“. Über **„Weitere
  Informationen“ → „Trotzdem ausführen“** starten, oder vorher in den
  Dateieigenschaften „Zulassen“ anhaken.
- **WebView2:** Die WebView2-Runtime wird vorausgesetzt (bei Windows 11
  vorinstalliert, bei Windows 10 meist über Edge vorhanden). Fehlt sie, zeigt
  die App eine Fehlermeldung mit Link zum Download bei Microsoft und beendet
  sich.
- **Eine Instanz:** Ein zweiter Start holt das laufende Fenster nach vorn,
  statt eine zweite Instanz zu öffnen.
- **Aktualisieren:** Belegwerk prüft beim Start, ob auf GitHub eine neuere
  Version veröffentlicht ist, und zeigt dann in der oberen Leiste einen
  Hinweis; „Jetzt aktualisieren“ lädt sie herunter, prüft die Prüfsumme,
  ersetzt die `.exe` und startet neu. Manuell: Einstellungen → „Nach Updates
  suchen“. Bei Fehlern bleibt die alte Version unverändert. Die `.exe` muss
  dafür in einem Ordner mit Schreibrechten liegen
  ([Auto-Update](docs/release.md#auto-update-71)). Von Hand geht es weiterhin:
  App schließen, die alte `.exe` durch die neue ersetzen. Die Daten bleiben
  erhalten; ausstehende Datenbank-Migrationen laufen beim Start. Vorher ein
  Backup erstellen.
- **Deinstallieren:** Backup erstellen, `.exe` löschen, optional die
  Datenordner (siehe unten) löschen.

## Datenspeicherung

Die Daten liegen nicht neben der `.exe`, sondern im Benutzerprofil:

| Was             | Ort                                             |
| --------------- | ----------------------------------------------- |
| Datenbank       | `%APPDATA%\de.belegwerk.desktop\belegwerk.db`   |
| Protokoll       | `%LOCALAPPDATA%\de.belegwerk.desktop\logs`      |
| WebView2-Profil | `%LOCALAPPDATA%\de.belegwerk.desktop\EBWebView` |

Die Datenbank ist eine einzelne SQLite-Datei (Journal-Modus `DELETE`, keine
`-wal`/`-shm`-Dateien). Kann die App sie nicht öffnen, verweist der
Fehlerbildschirm auf das Protokoll.

### Datensicherung

**Backup erstellen:** Einstellungen → Datensicherung → „Backup erstellen“.
Die App schreibt eine konsistente Kopie der ganzen Datenbank an einen frei
gewählten Ort (Vorschlag `belegwerk-backup-YYYY-MM-DD_HHMM.db`) und prüft sie
anschließend.

- **Nie im Datenordner der App speichern** (`%APPDATA%\de.belegwerk.desktop`
  und darunter). Die App lehnt ein solches Ziel ab – es würde die laufende
  Datenbank gefährden und beim Deinstallieren mit gelöscht. Umwege über
  symbolische Links, Junctions, Hardlinks, zugeordnete Laufwerke oder
  UNC-Pfade auf den eigenen Rechner (`\\localhost\C$\…`) erkennt sie nicht.
- **Das Backup enthält alle Daten, auch den Stripe-Schlüssel im Klartext.**
  Backups entsprechend sicher aufbewahren.

**Wiederherstellen (manuell):**

1. Belegwerk schließen (es darf kein Prozess `belegwerk.exe` mehr laufen,
   sonst ist die Datei gesperrt).
2. Den Ordner `%APPDATA%\de.belegwerk.desktop` öffnen (Explorer-Adresszeile).
3. Die vorhandene `belegwerk.db` zur Sicherheit umbenennen oder wegkopieren,
   z. B. in `belegwerk-vorher.db`.
4. Die Backup-Datei in diesen Ordner kopieren und in `belegwerk.db`
   umbenennen. Vorher prüfen, dass sie nicht 0 Byte groß ist.
5. Liegt dort eine `belegwerk.db-journal` (nur nach einem Absturz mitten in
   einem Schreibvorgang), gehört sie zur alten Datenbank: löschen bzw. mit
   verschieben – sonst würde SQLite sie auf das Backup anwenden.
6. Belegwerk starten.

Verhalten beim Start:

- **Backup einer älteren App-Version:** Die fehlenden Migrationen werden
  angewendet; danach ist die Datenbank auf dem Stand der App.
- **Backup einer neueren App-Version:** Der Start bricht mit einem
  Fehlerbildschirm ab, die Datei bleibt unverändert. Dann die neuere
  App-Version verwenden oder die alte `belegwerk.db` zurücklegen.
- **Leere Datei** (z. B. nach einem fehlgeschlagenen Backup): wird wie eine
  neue Datenbank behandelt – leer, nur mit Standardkategorien.

Details: [Datenmodell – Backup und Wiederherstellung](docs/data-model.md#backup-und-wiederherstellung-32).

## Stripe einrichten

Der Import liest **Application Fees** (Stripe Connect) und deren
Rückerstattungen. Belegwerk nimmt nur einen eingeschränkten, lesenden
Schlüssel an.

1. **Restricted Key anlegen:** im Stripe-Dashboard unter Entwickler →
   API-Schlüssel → „Eingeschränkten Schlüssel erstellen“ (englisch:
   Developers → API keys → Create restricted key). Berechtigung
   **„Application fees: Lesen“** (Read), alle anderen auf **„Keine“**
   (None). Rückerstattungen von Fees sind darin enthalten.
2. **Schlüssel hinterlegen:** in Belegwerk unter Einstellungen → Stripe
   einfügen und speichern. Angenommen werden nur `rk_live_…` und `rk_test_…`;
   geheime (`sk_…`) und veröffentlichbare (`pk_…`) Schlüssel werden
   abgelehnt. Die App zeigt den Schlüssel danach nur maskiert
   (`rk_live_…AbCd`), speichert ihn aber **im Klartext** in der lokalen
   Datenbank (und damit auch in Backups).
3. **„Verbindung testen“** prüft Schlüssel und Berechtigung.
4. **Standardwerte** festlegen und speichern: USt-Satz der Fees (gilt nur in
   regelbesteuerten Jahren; im Kleinunternehmer-Jahr wird ohne Satz gebucht),
   Kategorie für Fees (Einnahme) und für Rückerstattungen (Ausgabe mit
   „mindert Einnahmen“). Die App schlägt passende Werte vor.
5. **Importieren:** Buchungen → „Stripe importieren“, Zeitraum wählen
   (Vorschlag: vom Ende des letzten Imports bis heute) und starten. Das
   Ergebnis nennt neue, übersprungene und nicht gebuchte Einträge.

Hinweise:

- **Test-Schlüssel** (`rk_test_…`): Der Dialog warnt, dass Test-Fees als
  echte Buchungen in Buchhaltung und EÜR landen, und verlangt eine
  Bestätigung. Solche Buchungen lassen sich über den Filter Quelle „Stripe“
  finden und löschen.
- **Duplikatschutz** nur über die Stripe-ID (`fee_…`, `fr_…`): Bereits
  importierte Einträge werden übersprungen; gelöschte Buchungen legt ein
  erneuter Import wieder an. Importierte Buchungen sind normale Buchungen
  und frei bearbeitbar.
- **Grenze des Rückblicks:** Rückerstattungen auf Fees, die mehr als
  **180 Tage vor Beginn des Zeitraums** erstellt wurden, findet der Import
  nicht – diese manuell buchen.
- Nur EUR-Beträge werden gebucht; andere Währungen erscheinen als „nicht
  gebucht“.

## Entwicklung

### Voraussetzungen

| Werkzeug         | Version                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Windows          | 10/11 (die App ist nur für Windows gebaut)                                                                |
| Node.js          | ≥ 26 (`engines` in `package.json`)                                                                        |
| pnpm             | 12, genaue Version über `packageManager` in `package.json` (z. B. per `corepack enable`)                  |
| Rust             | stable, mindestens 1.90 (`rust-version` in `src-tauri/Cargo.toml`), MSVC-Toolchain                        |
| WebView2-Runtime | siehe [Installation](#installation)                                                                       |
| Tauri-Vorauss.   | Microsoft C++ Build Tools, siehe [Tauri-Prerequisites](https://v2.tauri.app/start/prerequisites/#windows) |

### Setup

```sh
pnpm install
pnpm tauri dev   # startet Vite (Port 1420) und das Desktop-Fenster
```

`pnpm dev` allein startet nur Vite; im normalen Browser gibt es kein Tauri und
keine Datenbank, die App zeigt dann „Belegwerk läuft nur als Desktop-App“.
Läuft die Release-`.exe`, beendet sich `pnpm tauri dev` sofort und holt deren
Fenster nach vorn (gleiche Datenbank) – vorher die `.exe` schließen.

### Scripts

| Script              | Zweck                                                                          |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`          | Vite-Dev-Server (nur Frontend, siehe oben)                                     |
| `pnpm build`        | Frontend bauen (`dist/client`)                                                 |
| `pnpm tauri …`      | Tauri-CLI, z. B. `pnpm tauri dev`, `pnpm tauri build --no-bundle`              |
| `pnpm typecheck`    | Paraglide-Messages kompilieren, dann `tsc -b`                                  |
| `pnpm lint`         | oxlint (inkl. Layer-Grenzen), Warnungen sind Fehler                            |
| `pnpm format`       | oxfmt: formatieren                                                             |
| `pnpm format:check` | oxfmt: nur prüfen                                                              |
| `pnpm test`         | Vitest, alle Tests einmal                                                      |
| `pnpm test:watch`   | Vitest im Watch-Modus                                                          |
| `pnpm db:generate`  | drizzle-kit: Migration aus dem Schema erzeugen                                 |
| `pnpm i18n:compile` | Paraglide-Messages nach `src/paraglide/` kompilieren                           |
| `pnpm verify`       | `format:check`, `lint`, `typecheck`, `test` – vor jedem Commit/Release         |
| `pnpm release`      | Release-`.exe` bauen und nach `release/` kopieren ([Release](docs/release.md)) |

### CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) auf
`windows-latest` für jeden Pull Request und jeden Push auf `main`:
Format-Check, Lint, Typecheck, Tests, Prüfung, dass die Migrationen zum Schema
passen (`pnpm db:generate` ohne Änderung), und `pnpm tauri build --no-bundle`.
Die gebaute `.exe` steht 7 Tage als Artefakt des Laufs zum Ausprobieren
bereit.

Jeder Push auf `main` startet zusätzlich
[`.github/workflows/release.yml`](.github/workflows/release.yml) und erzeugt ein
Release: gleiche Prüfungen, Version aus der aktuellen Zeit in UTC (echt größer
als das letzte Release-Tag, sonst dieses + 1 Minute), Build und ein
GitHub-Release mit `.exe` und `.sha256` samt Tag `v<YYYY-MM-DD-HHMM>` auf dem
Commit. Die Läufe laufen nacheinander, keiner wird abgebrochen
([Release](docs/release.md#release-veröffentlichen-71-74)).

## Architektur

Tauri v2 ist nur Host (Fenster, SQLite, Dateidialoge, HTTP, Auto-Update); die gesamte Logik
läuft in TypeScript im WebView – TanStack Start im SPA-Modus mit TanStack
Router/Query/Table/Form, shadcn/ui und Tailwind. Persistenz über
`tauri-plugin-sql` und Drizzle ORM (`sqlite-proxy`), Texte über Paraglide JS
(nur Deutsch).

```
src/routes ─┬──────────────────► src/app ──────────────┐
src/ui ─────┤                   (Composition Root)     │ verdrahtet
            │                        │                 ▼
            └──► src/business ◄──────┴────────── src/persistence
```

Pfeile = „importiert aus“.

| Layer             | Inhalt                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `src/routes`      | Routen (dateibasiert), dünn: Parameter lesen, Services aufrufen, UI rendern              |
| `src/ui`          | Darstellung: Komponenten, Styles, shadcn/ui                                              |
| `src/business`    | Fachlogik, Validierung, Services und Repository-Interfaces – kein React, kein Tauri      |
| `src/persistence` | Drizzle-Schema, Migrationen, Implementierungen der Repository-Interfaces                 |
| `src/app`         | Composition Root: öffnet die DB, migriert, erzeugt Services und stellt sie der UI bereit |

UI und Routen erreichen die Daten nur über Services aus `src/app`; Business
kennt Persistence nicht (Dependency Inversion). Die Grenzen erzwingt oxlint
(`no-restricted-imports`, [`.oxlintrc.json`](.oxlintrc.json)).

Weiterführend:

- [Architektur](docs/architecture.md) – Layer, Services, Routen, Stripe, Datensicherung
- [Datenmodell](docs/data-model.md) – Tabellen, EÜR-Positionen und -Berechnung, Migrationen, Backup
- [i18n & Formatierung](docs/i18n.md) – Paraglide, Format-Helper
- [Tests](docs/testing.md) – Vitest, Fakes, Persistence-Tests
- [Release](docs/release.md) – Release bei jedem Push auf `main`, Auto-Update, `.exe` bauen, Version, Speicherorte
