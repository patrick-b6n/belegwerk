# Release (#33, #71, #74)

Belegwerk wird als **einzelne `.exe`** ausgeliefert – kein Installer (kein
NSIS/MSI), keine Code-Signierung. **Jeder Push auf `main` erzeugt ein
GitHub-Release**; die App aktualisiert sich daraus selbst
([Auto-Update](#auto-update-71)).

## Versionsschema (#71)

Versionen sind **Datum und Uhrzeit des Releases in UTC** (CalVer, ohne
Trenner zwischen Stunde und Minute): `YYYY-MM-DD-HHMM`, z. B.
`2026-11-14-2000` für den 14.11.2026, 20:00 Uhr UTC. Das gilt für
veröffentlichte Releases und lokale Builds gleichermaßen, unabhängig von der
Zeitzone des Rechners und ohne Sprünge bei der Zeitumstellung. Die Uhrzeit
ist also **nicht die deutsche Ortszeit**: Ein Release um 20:00 Uhr in Berlin
heißt im Winter (MEZ, UTC+1) `…-1900`, im Sommer (MESZ, UTC+2) `…-1800`.
So heißen Tag (`v2026-11-14-2000`), Release, Assets (`belegwerk-2026-11-14-2000.exe`) und
so zeigt die App (Einstellungen, Update-Hinweis, Protokoll) die Version.

Tauri und die Windows-Dateiversion brauchen SemVer mit Zahlen bis 65535 ohne
führende Nullen. Intern (package.json, `.exe`) steht deshalb
`YYYY.(MM*100+DD).(HH*100+MM)`: `2026-11-14-2000` → `2026.1114.2000`,
`2026-01-05-0930` → `2026.105.930`. Die Reihenfolge bleibt erhalten. Die
Umrechnung in beide Richtungen steht in `src/business/updates/calver.ts`
(Scripts, Workflow, UI) und in `src-tauri/src/updater.rs` (Updater), jeweils
mit Tests.

**Niemand pflegt die Version von Hand.** In `package.json` steht committet
der Platzhalter `0.0.0` (Entwicklung; gilt im Updater als älter als jedes
Release, installiert wird in Debug-Builds trotzdem nicht). Die Version
entsteht im Release-Workflow bzw. beim lokalen Bauen; die `version` in
`src-tauri/Cargo.toml` wird nicht verwendet.

## Release veröffentlichen (#71, #74)

Es gibt keinen manuellen Schritt: **Jeder Push auf `main`** (also jeder
gemergte Pull Request) startet `.github/workflows/release.yml`
(windows-latest, gleiches Setup wie CI). Von Hand lässt sich der Workflow
über „Run workflow“ (`workflow_dispatch`) starten – nur auf `main`, auf
anderen Branches wird der Job übersprungen.

1. `pnpm verify` und die Migrationsprüfung (`pnpm db:generate` ohne
   Änderung) – CI (`ci.yml`) läuft nur für Pull Requests, auf `main` prüft
   allein dieser Workflow.
2. **Version bestimmen** (`scripts/release-version.ts`): die aktuelle Zeit
   in **UTC** als `YYYY-MM-DD-HHMM` (`calVerFromDate`). Die vorhandenen
   Tags `v*` holt der Workflow über die GitHub-API
   (`git/matching-refs/tags/v`). Ist die Uhrzeit **nicht echt größer** als
   das höchste Release-Tag (verglichen in SemVer-Form), wird die Version
   **höchstes Tag + 1 Minute** (`nextReleaseCalVer`, mit Übertrag in Stunde,
   Tag, Monat und Jahr) – etwa bei zwei Pushes in derselben Minute oder
   einer nachgehenden Uhr. Der Lauf scheitert also nicht und wartet auch
   nicht; die Version liegt dann höchstens ein paar Minuten vor der Uhrzeit.
3. Build mit `node scripts/release.ts --calver <version>`: setzt die
   SemVer-Form in `package.json` (nur im Checkout von CI, nicht committet),
   gleiches Release-Profil wie CI, prüft die Dateiversion der `.exe`.
4. `gh release create "v<version>" --target <commit> --generate-notes
   --latest`: legt das Tag `v<version>` auf den gebauten Commit und das
   GitHub-Release „Belegwerk `<version>`“ an, mit den Assets
   `belegwerk-<version>.exe` und `belegwerk-<version>.exe.sha256`. Das
   Release ist kein Pre-release und als „Latest“ markiert – genau das liest
   die App (`releases/latest`). `gh` lädt die Assets hoch, bevor es das
   Release veröffentlicht – die App sieht also nie ein Release ohne Assets.

**Nur der aktuelle Stand:** Zu Beginn und noch einmal direkt vor
`gh release create` prüft der Job, dass der gebaute Commit (`GITHUB_SHA`)
noch der Stand von `main` ist (`gh api repos/…/commits/main`). Sonst endet er
erfolgreich ohne Release, mit einem Hinweis im Log – etwa beim Re-run eines
alten Laufs oder wenn `main` während des Builds weitergerückt ist. Die Commits
veröffentlicht dann der neuere Lauf; ein älterer Stand wird nie „Latest“.

**Nur ein Lauf:** Alle Läufe auf `main` teilen sich eine Concurrency-Gruppe
(`<workflow>-<ref>`) mit `cancel-in-progress: true`. Ein neuer Push bricht
den laufenden (oder wartenden) Lauf ab; das Release des neuen Laufs enthält
dann auch dessen Commits. Ein abgebrochener Lauf hat noch keinen Tag angelegt,
die Version bestimmt der neue Lauf aus den vorhandenen Tags. Ebenso bricht in
CI ein neuer Push auf einen Pull Request dessen laufende Prüfung ab.

Der Job hat als einziger `contents: write`; der Checkout speichert keine
Zugangsdaten (`persist-credentials: false`), `gh` nutzt das `GITHUB_TOKEN`.
Den Cargo-Cache von `main` speichert dieser Job (`shared-key:
tauri-release`, derselbe Schlüssel wie in `ci.yml`); CI-Läufe in Pull
Requests stellen ihn nur wieder her. Vorabversionen (in GitHub als
„Pre-release“ markiert) und Entwürfe liefert die API unter
`releases/latest` nicht aus; die App bietet sie also nicht an.

## Lokal bauen

```sh
pnpm verify    # format:check, lint, typecheck, test
pnpm release   # baut die .exe
```

Lokale Builds werden **nicht veröffentlicht** – Releases entstehen nur im
Workflow ([Release veröffentlichen](#release-veröffentlichen-71-74)).

`pnpm release` (`scripts/release.ts`):

1. Version = aktuelle Zeit in UTC (`YYYY-MM-DD-HHMM`, wie im Workflow) oder
   `--calver <YYYY-MM-DD-HHMM>` (so ruft der Workflow es auf). Die SemVer-Form kommt
   für den Build in `package.json` und wird danach wiederhergestellt (auch
   bei Fehlern und Strg+C).
2. `pnpm tauri build --no-bundle` – Frontend bauen (`pnpm build`,
   `beforeBuildCommand`), Rust im Release-Profil kompilieren, Frontend in die
   `.exe` einbetten. `--no-bundle` überspringt die Installer.
3. Kopiert `src-tauri/target/release/belegwerk.exe` nach
   `release/belegwerk-<version>.exe` und schreibt die Prüfsumme nach
   `release/belegwerk-<version>.exe.sha256` (Format von `sha256sum`). Läuft
   die `.exe` gerade (Datei gesperrt), bricht es mit einer Meldung ab.
4. Prüft, dass die Dateiversion der `.exe` der SemVer-Form entspricht (auch
   mit angehängtem `.0`; bricht sonst ab).
5. Gibt Pfad, Version, Größe und SHA-256 aus. Builds sind nicht bitgenau
   reproduzierbar; die Prüfsumme identifiziert nur diese Datei.

`release/` ist git-ignoriert. Die Prüfungen laufen bewusst nicht in
`pnpm release` (der Build dauert ohnehin einige Minuten; CI prüft jeden
Commit) – vor einem Release also `pnpm verify` ausführen. Sind nicht
committete Änderungen vorhanden, warnt das Script (bricht aber nicht ab).

Prüfsumme kontrollieren: `Get-FileHash belegwerk-2026-11-14-2000.exe`
(PowerShell) bzw. `sha256sum -c belegwerk-2026-11-14-2000.exe.sha256`.

## Version, Name, Icon

- **Version:** `version` in `package.json` – committet `0.0.0`, beim
  Release-Build die SemVer-Form der CalVer ([Versionsschema](#versionsschema-71)).
  `src-tauri/tauri.conf.json` verweist mit `"version": "../package.json"`
  darauf; `tauri-build` schreibt sie als Datei- und Produktversion in die
  `.exe`. Da `tauri-build` nur bei Änderungen an `tauri.conf.json` neu
  läuft, meldet `src-tauri/build.rs` zusätzlich `package.json` als Abhängigkeit
  (`cargo:rerun-if-changed`) – sonst bliebe nach einer Versionserhöhung bei
  inkrementellen Builds die alte Version in der `.exe`. Die `version` in
  `src-tauri/Cargo.toml` wird nicht verwendet.
- **Name:** `productName` „Belegwerk“ → Produktname und Dateibeschreibung,
  `bundle.publisher` „Belegwerk“ → Firma.
- **Icon:** `src-tauri/icons/icon.ico` wird als Ressource eingebettet
  (Explorer, Taskleiste, Fenster).

Kontrolle: `(Get-Item release\belegwerk-2026-11-14-2000.exe).VersionInfo | Format-List`
(Dateiversion `2026.1114.2000`).

## Release-Profil

`[profile.release]` in `src-tauri/Cargo.toml`:

| Einstellung     | Wert   | Grund                                                        |
| --------------- | ------ | ------------------------------------------------------------ |
| `codegen-units` | `1`    | LLVM optimiert die ganze Crate auf einmal                    |
| `lto`           | `true` | Link-Time-Optimization über alle Crates (fat LTO)            |
| `opt-level`     | `"s"`  | auf Größe optimiert                                          |
| `strip`         | `true` | Debug-Symbole entfernen                                      |
| `panic`         | –      | bleibt `unwind`: Panic beendet nur den Aufruf, nicht die App |

Gemessen (Windows, Rust 1.99): ohne Profil 20,4 MB, mit `opt-level = 3`
17,9 MB, mit `opt-level = "s"` 13,1 MB. Die Rust-Seite registriert nur
Plugins, die Laufzeit hängt an WebView2 und SQLite; `"s"` bringt deshalb
spürbar weniger Größe ohne merklichen Nachteil beim Start. Kosten: Der
Release-Build dauert länger (lokal, Abhängigkeiten im Cache: ca. 1,5–2,5 min
statt ca. 0,5 min). CI baut dasselbe Profil.

## Starten

- Die `.exe` startet aus jedem Ordner (auch mit Leerzeichen/Umlauten im Pfad);
  sie braucht keine weiteren Dateien.
- **Kein Konsolenfenster:** `src-tauri/src/main.rs` setzt im Release
  `windows_subsystem = "windows"`.
- **Eine Instanz:** `tauri-plugin-single-instance` (erstes Plugin in
  `src-tauri/src/lib.rs`). Ein zweiter Start beendet sich sofort und holt das
  laufende Fenster nach vorn (auch aus dem minimierten Zustand). So öffnen nie
  zwei Prozesse dieselbe Datenbank. Das gilt auch für die Entwicklung:
  Läuft die Release-`.exe`, beendet sich `pnpm tauri dev` sofort und holt das
  Fenster der `.exe` nach vorn (gleicher Identifier, gleiche Datenbank) –
  vorher die `.exe` schließen.
- **WebView2:** Voraussetzung ist die WebView2-Runtime (bei Windows 11
  vorinstalliert, bei Windows 10 meist über Edge vorhanden). Fehlt sie, zeigt
  die `.exe` eine Fehlermeldung von Tauri („Could not find the WebView2
  Runtime“, mit Link zum Download bei Microsoft) und beendet sich. Die
  Einstellung `bundle.windows.webviewInstallMode` gilt nur für Installer und
  ist hier wirkungslos.

### Unsignierte .exe: SmartScreen

Die `.exe` ist nicht signiert. Wurde sie heruntergeladen (Mark of the Web),
zeigt Windows beim ersten Start „Der Computer wurde durch Windows geschützt“
(Herausgeber: „Unbekannter Herausgeber“). Starten über **„Weitere
Informationen“ → „Trotzdem ausführen“**. Alternativ vorher in den
Dateieigenschaften „Zulassen“ anhaken (entfernt die Download-Markierung).

## Auto-Update (#71)

Tauris Updater-Plugin setzt einen Installer bzw. ein Archiv voraus; für eine
einzelne `.exe` übernimmt Belegwerk den Austausch selbst
(`src-tauri/src/updater.rs`, Tauri-Commands `check_for_update` und
`install_update`; Frontend siehe
[Architektur](architecture.md#auto-update-71)).

**Prüfen** – beim Start im Hintergrund und über „Nach Updates suchen“ in den
Einstellungen: `GET https://api.github.com/repos/patrick-b6n/belegwerk-next/releases/latest`
(öffentliches Repository, kein Token; User-Agent `Belegwerk-Updater`, keine
persönlichen Daten), den Tag `v<YYYY-MM-DD-HHMM>` in die SemVer-Form
umrechnen und mit der laufenden Version vergleichen. Ist sie neuer, erscheint in der oberen Leiste ein Hinweis mit
Version, Link zu den Release-Notes (Standardbrowser) und „Jetzt
aktualisieren“. Ohne Netz oder bei GitHub-Fehlern erscheint beim Start nichts,
nur ein Eintrag im Protokoll.

**Aktualisieren** („Jetzt aktualisieren“):

1. Release erneut bei GitHub abfragen (die App vertraut keinen URLs aus der
   WebView) und prüfen, dass es neuer ist.
2. `belegwerk-<version>.exe.sha256` laden (Format von `sha256sum`), dann
   `belegwerk-<version>.exe` nach `<exe>.update` **neben** die laufende
   `.exe` (gleiches Laufwerk; eine alte `.update` wird vorher gelöscht, die
   Datei dann exklusiv neu angelegt); danach Größe und SHA-256 der Datei auf
   der Platte prüfen. Die `.sha256` darf höchstens 4 KB groß sein. Beide URLs
   müssen Downloads dieses Repositorys sein.
3. Austausch: laufende `.exe` → `<exe>.old` umbenennen (Windows erlaubt das
   Umbenennen, nicht das Überschreiben eines laufenden Programms), dann
   `<exe>.update` → `<exe>`. Scheitert der zweite Schritt, wird der erste
   rückgängig gemacht.
4. Neustart (`app.restart()`); die neue Version löscht beim Start
   `<exe>.old` (und eine liegen gebliebene `<exe>.update`).

Bis zum Austausch ändert sich neben der `.exe` nur die Datei `<exe>.update`,
die bei jedem Fehler gelöscht wird: **Bei Fehlern bleibt die alte Version
unverändert**, die App zeigt eine Meldung (keine Verbindung, Prüfsumme
falsch, keine Schreibrechte im Ordner der `.exe` …).

- **Dateiname:** Das Update ersetzt die `.exe` unter ihrem bisherigen Namen.
  Wer `belegwerk-2026-11-14-2000.exe` heruntergeladen hat, behält nach
  Updates diesen Namen, auch wenn darin längst eine neuere Version steckt.
  Empfehlung: die heruntergeladene Datei vor dem ersten Start in
  `belegwerk.exe` umbenennen (Verknüpfungen bleiben dann auch gültig).
- **Nur ein Update gleichzeitig:** Ein zweiter Aufruf, während eines läuft
  (Hinweis und Einstellungen), scheitert mit „Das Update wird bereits
  installiert.“.
- **Rollback gescheitert:** Lässt sich die neue `.exe` nicht einsetzen und
  die alte danach nicht zurückbenennen (sehr unwahrscheinlich, z. B. wenn ein
  Virenscanner die Datei sperrt), fehlt die `.exe`. Die Meldung nennt dann
  die Datei `<exe>.old`; sie muss von Hand zurückbenannt werden (Endung
  `.old` entfernen).
- **Entwicklungsmodus** (`pnpm tauri dev`, Debug-Build): `install_update`
  lehnt ab, es wird nie ersetzt. Testen nur mit einer Release-`.exe`.
- **Schreibrechte:** Die `.exe` muss in einem Ordner liegen, in dem der
  Benutzer schreiben darf (z. B. nicht unter `C:\Program Files`); sonst
  meldet das Update einen Fehler und bleibt auf der alten Version.
- **SmartScreen:** Die per App geladene `.exe` trägt keine Download-Markierung
  (Mark of the Web); SmartScreen fragt nach dem Update nicht erneut.
- **Datenbank:** bleibt, wo sie ist; ausstehende Migrationen laufen beim
  Neustart.
- **Berechtigungen:** Die Commands sind im App-Manifest deklariert
  (`src-tauri/build.rs`) und nur mit `allow-check-for-update` bzw.
  `allow-install-update` aufrufbar; der Opener darf nur
  `https://github.com/patrick-b6n/belegwerk-next/releases/*` öffnen
  (`src-tauri/capabilities/default.json`). Die CSP bleibt unverändert – die
  Anfragen laufen in Rust (`reqwest` mit rustls, derselbe TLS-Stack wie
  `tauri-plugin-http`).

Manuell aktualisieren geht weiterhin: App schließen, `.exe` durch die neue
ersetzen.

## Daten

Die Daten liegen **nicht** neben der `.exe`, sondern im Benutzerprofil:

| Was             | Ort                                             |
| --------------- | ----------------------------------------------- |
| Datenbank       | `%APPDATA%\de.belegwerk.desktop\belegwerk.db`   |
| Protokoll       | `%LOCALAPPDATA%\de.belegwerk.desktop\logs`      |
| WebView2-Profil | `%LOCALAPPDATA%\de.belegwerk.desktop\EBWebView` |

Eine neue Version (Auto-Update oder von Hand) ersetzt nur die `.exe`; die
Datenbank bleibt, ausstehende Migrationen laufen beim Start ([Datenmodell](data-model.md)). Deinstallieren:
`.exe` löschen, optional die beiden Ordner (vorher ein Backup erstellen,
siehe [Datensicherung](architecture.md#datensicherung-32)).
