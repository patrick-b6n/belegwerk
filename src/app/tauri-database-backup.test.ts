import { beforeEach, describe, expect, it, vi } from "vitest";

const plugins = vi.hoisted(() => ({
  writeTextFile: vi.fn<(path: string, data: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: plugins.writeTextFile }));

const { createTauriDatabaseBackup } = await import("./tauri-database-backup");

const PATH = "C:\\Users\\Jörg\\Meine Sicherungen\\belegwerk-backup.db";

describe("createTauriDatabaseBackup", () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    plugins.writeTextFile.mockReset().mockImplementation(async (path, data) => {
      calls.push(`truncate ${path} ${JSON.stringify(data)}`);
    });
  });

  it("empties the picked file, then lets SQLite write the backup into it", async () => {
    const backup = createTauriDatabaseBackup({
      backupTo: async (path) => {
        calls.push(`vacuum ${path}`);
      },
    });
    await backup.writeTo(PATH);
    expect(calls).toEqual([`truncate ${PATH} ""`, `vacuum ${PATH}`]);
  });

  it("empties the file again and rethrows when the backup fails", async () => {
    const backup = createTauriDatabaseBackup({
      backupTo: async () => {
        calls.push("vacuum");
        throw new Error("disk full");
      },
    });
    await expect(backup.writeTo(PATH)).rejects.toThrow("disk full");
    expect(calls).toEqual([`truncate ${PATH} ""`, "vacuum", `truncate ${PATH} ""`]);
  });

  it("does not start the backup if the file cannot be written", async () => {
    plugins.writeTextFile.mockRejectedValue(new Error("forbidden path"));
    const backupTo = vi.fn<(path: string) => Promise<void>>();
    await expect(createTauriDatabaseBackup({ backupTo }).writeTo(PATH)).rejects.toThrow(
      "forbidden path",
    );
    expect(backupTo).not.toHaveBeenCalled();
  });
});
