# Release (#33)

Belegwerk wird als **einzelne `.exe`** ausgeliefert – kein Installer (kein
NSIS/MSI), keine Code-Signierung, kein Auto-Update.

## Bauen

```sh
pnpm verify    # format:check, lint, typecheck, test
pnpm release   # baut die .exe
```

`pnpm release` (`scripts/release.ts`):

1. `pnpm tauri build --no-bundle` – Frontend bauen (`pnpm build`,
   `beforeBuildCommand`), Rust im Release-Profil kompilieren, Frontend in die
   `.exe` einbetten. `--no-bundle` überspringt die Installer.
2. Kopiert `src-tauri/target/release/belegwerk.exe` nach
   `release/belegwerk-<version>.exe` und schreibt die Prüfsumme nach
   `release/belegwerk-<version>.exe.sha256` (Format von `sha256sum`). Läuft
   die `.exe` gerade (Datei gesperrt), bricht es mit einer Meldung ab.
3. Prüft, dass die Dateiversion der `.exe` der `version` aus `package.json`
   entspricht (bricht sonst ab).
4. Gibt Pfad, Größe und SHA-256 aus. Builds sind nicht bitgenau
   reproduzierbar; die Prüfsumme identifiziert nur diese Datei.

`release/` ist git-ignoriert. Die Prüfungen laufen bewusst nicht in
`pnpm release` (der Build dauert ohnehin einige Minuten; CI prüft jeden
Commit) – vor einem Release also `pnpm verify` ausführen. Sind nicht
committete Änderungen vorhanden, warnt das Script (bricht aber nicht ab).

Prüfsumme kontrollieren: `Get-FileHash belegwerk-0.1.0.exe` (PowerShell) bzw.
`sha256sum -c belegwerk-0.1.0.exe.sha256`.

## Version, Name, Icon

- **Version:** einzige Quelle ist `version` in `package.json`.
  `src-tauri/tauri.conf.json` verweist mit `"version": "../package.json"`
  darauf; `tauri-build` schreibt sie als Datei- und Produktversion in die
  `.exe`. Da `tauri-build` nur bei Änderungen an `tauri.conf.json` neu
  läuft, meldet `src-tauri/build.rs` zusätzlich `package.json` als Abhängigkeit
  (`cargo:rerun-if-changed`) – sonst bliebe nach einer Versionserhöhung bei
  inkrementellen Builds die alte Version in der `.exe`. Die `version` in
  `src-tauri/Cargo.toml` wird dafür nicht verwendet (von Hand mitgezogen).
- **Name:** `productName` „Belegwerk“ → Produktname und Dateibeschreibung,
  `bundle.publisher` „Belegwerk“ → Firma.
- **Icon:** `src-tauri/icons/icon.ico` wird als Ressource eingebettet
  (Explorer, Taskleiste, Fenster).

Kontrolle: `(Get-Item release\belegwerk-0.1.0.exe).VersionInfo | Format-List`.

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

## Daten

Die Daten liegen **nicht** neben der `.exe`, sondern im Benutzerprofil:

| Was             | Ort                                             |
| --------------- | ----------------------------------------------- |
| Datenbank       | `%APPDATA%\de.belegwerk.desktop\belegwerk.db`   |
| Protokoll       | `%LOCALAPPDATA%\de.belegwerk.desktop\logs`      |
| WebView2-Profil | `%LOCALAPPDATA%\de.belegwerk.desktop\EBWebView` |

Eine neue Version ersetzt nur die `.exe`; die Datenbank bleibt, ausstehende
Migrationen laufen beim Start ([Datenmodell](data-model.md)). Deinstallieren:
`.exe` löschen, optional die beiden Ordner (vorher ein Backup erstellen,
siehe [Datensicherung](architecture.md#datensicherung-32)).
