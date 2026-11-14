import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackupTargetInDatabaseFolderError, BackupWriteError } from "@/business/backup";

const plugins = vi.hoisted(() => ({
  writeTextFile: vi.fn<(path: string, data: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: plugins.writeTextFile }));

const { createTauriDatabaseBackup } = await import("./tauri-database-backup");

const FOLDER = "C:\\Users\\Jörg\\AppData\\Roaming\\de.belegwerk.desktop";
const DB = `${FOLDER}\\belegwerk.db`;
const PATH = "C:\\Users\\Jörg\\Meine Sicherungen\\belegwerk-backup.db";

describe("createTauriDatabaseBackup", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    plugins.writeTextFile.mockReset().mockImplementation(async (path, data) => {
      calls.push(`truncate ${path} ${JSON.stringify(data)}`);
    });
  });

  function backup(backupTo: (path: string) => Promise<void> = async () => {}) {
    return createTauriDatabaseBackup({
      mainFilePath: async () => DB,
      backupTo: async (path) => {
        calls.push(`vacuum ${path}`);
        await backupTo(path);
      },
    });
  }

  it("empties the picked file, then lets SQLite write the backup into it", async () => {
    await backup().writeTo(PATH);
    expect(calls).toEqual([`truncate ${PATH} ""`, `vacuum ${PATH}`]);
  });

  it("empties the file again and reports it when the backup fails", async () => {
    const error = await backup(async () => {
      throw new Error("disk full");
    })
      .writeTo(PATH)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackupWriteError);
    expect(error).toMatchObject({ targetCleared: true, cause: new Error("disk full") });
    expect(calls).toEqual([`truncate ${PATH} ""`, `vacuum ${PATH}`, `truncate ${PATH} ""`]);
  });

  it("does not start the backup if the file cannot be written", async () => {
    plugins.writeTextFile.mockRejectedValue(new Error("forbidden path"));
    const error = await backup()
      .writeTo(PATH)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackupWriteError);
    expect(error).toMatchObject({ targetCleared: false });
    expect(calls).toEqual([]);
  });

  it.each([
    ["the live database", DB],
    ["the live database in other case", DB.toUpperCase()],
    ["the live database with forward slashes", DB.replaceAll("\\", "/")],
    ["its journal", `${DB}-journal`],
    ["its WAL", `${DB}-wal`],
    ["any file in its folder", `${FOLDER}\\belegwerk-backup.db`],
    ["a file in a subfolder", `${FOLDER}\\Sicherungen\\b.db`],
  ])("refuses %s before writing anything", async (_, target) => {
    await expect(backup().writeTo(target)).rejects.toBeInstanceOf(
      BackupTargetInDatabaseFolderError,
    );
    expect(plugins.writeTextFile).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("refuses to run without a known database file (no guard possible)", async () => {
    const adapter = createTauriDatabaseBackup({
      mainFilePath: async () => "",
      backupTo: async () => {},
    });
    await expect(adapter.writeTo(PATH)).rejects.toThrow(/unknown/);
    expect(plugins.writeTextFile).not.toHaveBeenCalled();
  });
});
