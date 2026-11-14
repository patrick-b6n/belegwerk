/**
 * Port for saving files (docs/architecture.md, "Plattformzugriffe"): Business
 * stays free of Tauri; `src/app` implements it with `tauri-plugin-dialog`
 * (save dialog) and `tauri-plugin-fs` (writing).
 */

export interface SaveTextFileRequest {
  /** File name the save dialog suggests, e.g. `buchungen-2025-01-01_2025-12-31.csv`. */
  readonly defaultFileName: string;
  /** File type filter of the dialog (UI text, e.g. "CSV-Datei") and its extensions without dot. */
  readonly filter: { readonly name: string; readonly extensions: readonly string[] };
  /** Written as UTF-8, unchanged (a leading BOM stays). */
  readonly content: string;
}

export type SaveTextFileResult =
  /** Written to `path` (the path the user chose). */
  | { readonly saved: true; readonly path: string }
  /** The user cancelled the dialog; nothing was written. */
  | { readonly saved: false };

export interface FileSaver {
  /**
   * Asks the user where to save (save dialog) and writes `content` there,
   * replacing an existing file (the dialog asks before overwriting).
   *
   * @throws if writing fails (e.g. no permission, file locked by Excel).
   */
  saveTextFile(request: SaveTextFileRequest): Promise<SaveTextFileResult>;
}

/** The file name of a saved path (last segment; Windows or POSIX separators). */
export function fileNameOfPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
