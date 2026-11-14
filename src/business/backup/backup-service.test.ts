import { describe, expect, it } from "vitest";

import type { PickSavePathRequest } from "../files";
import { createBackupService, type DatabaseBackup } from "./backup-service";
import { BackupTargetInDatabaseFolderError, BackupWriteError } from "./backup-target";

const NOW = new Date("2026-11-14T14:30:00Z");
const REQUEST = { fileNameBase: "belegwerk-backup", filterName: "SQLite-Datenbank" } as const;

function setup(picked: string | null, writeTo: DatabaseBackup["writeTo"] = async () => {}) {
  const calls: string[] = [];
  const requests: PickSavePathRequest[] = [];
  const service = createBackupService({
    savePathPicker: {
      pickSavePath: async (request) => {
        calls.push("dialog");
        requests.push(request);
        return picked;
      },
    },
    databaseBackup: {
      writeTo: async (path) => {
        calls.push(`write ${path}`);
        await writeTo(path);
      },
    },
    clock: () => NOW,
  });
  return { service, calls, requests };
}

describe("BackupService.createBackup", () => {
  it("suggests a dated name, then writes the backup to the picked path", async () => {
    const path = "C:\\Users\\Jörg\\Meine Sicherungen\\belegwerk-backup-2026-11-14_1530.db";
    const { service, calls, requests } = setup(path);

    expect(await service.createBackup(REQUEST)).toEqual({
      saved: true,
      fileName: "belegwerk-backup-2026-11-14_1530.db",
      path,
    });
    expect(requests).toEqual([
      {
        defaultFileName: "belegwerk-backup-2026-11-14_1530.db",
        filter: { name: "SQLite-Datenbank", extensions: ["db"] },
      },
    ]);
    expect(calls).toEqual(["dialog", `write ${path}`]);
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const { service, calls } = setup(null);
    expect(await service.createBackup(REQUEST)).toEqual({ saved: false, reason: "cancelled" });
    expect(calls).toEqual(["dialog"]);
  });

  it("reports a target in the database folder", async () => {
    const { service } = setup("C:\\data\\belegwerk.db", async () => {
      throw new BackupTargetInDatabaseFolderError();
    });
    expect(await service.createBackup(REQUEST)).toEqual({
      saved: false,
      reason: "targetInDatabaseFolder",
    });
  });

  it("propagates errors of writing the backup", async () => {
    const failure = new BackupWriteError(true, { cause: new Error("disk full") });
    const { service } = setup("D:\\backup.db", async () => {
      throw failure;
    });
    await expect(service.createBackup(REQUEST)).rejects.toBe(failure);
  });
});
