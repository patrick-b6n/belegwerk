import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DownloadProgress, UpdateError } from "@/business/updates";

const tauri = vi.hoisted(() => {
  class FakeChannel<T> {
    constructor(readonly onmessage: (message: T) => void) {}
  }
  return {
    invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    openUrl: vi.fn<(url: string) => Promise<void>>(),
    FakeChannel,
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke, Channel: tauri.FakeChannel }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));

const { createTauriUpdater, parseUpdateCheck, toUpdateError } = await import("./tauri-updater");

const RELEASE_URL = "https://github.com/patrick-b6n/belegwerk/releases/tag/v2026-11-14-2000";
const CHECK = {
  currentVersion: "2026-11-01-0930",
  latestVersion: "2026-11-14-2000",
  updateAvailable: true,
  releaseUrl: RELEASE_URL,
};

describe("createTauriUpdater", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.openUrl.mockReset().mockResolvedValue(undefined);
  });

  it("checks via the host command", async () => {
    tauri.invoke.mockResolvedValue(CHECK);
    await expect(createTauriUpdater().check()).resolves.toEqual(CHECK);
    expect(tauri.invoke).toHaveBeenCalledWith("check_for_update");
  });

  it("turns the host's error into an UpdateError of that kind", async () => {
    tauri.invoke.mockRejectedValue({ kind: "network", message: "dns error" });
    const error = await createTauriUpdater()
      .check()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UpdateError);
    expect(error).toMatchObject({ kind: "network", message: "dns error" });
  });

  it("refuses an unexpected check result", async () => {
    tauri.invoke.mockResolvedValue({ ...CHECK, releaseUrl: "https://example.com/" });
    await expect(createTauriUpdater().check()).rejects.toMatchObject({ kind: "unexpected" });
  });

  it("installs via the host command and forwards its progress", async () => {
    tauri.invoke.mockImplementation(async (_command, args) => {
      const channel = args?.onProgress as InstanceType<typeof tauri.FakeChannel<DownloadProgress>>;
      channel.onmessage({ downloaded: 1, total: 2 });
      channel.onmessage({ downloaded: 2, total: 2 });
    });
    const progress: DownloadProgress[] = [];
    await createTauriUpdater().install((value) => progress.push(value));
    expect(tauri.invoke).toHaveBeenCalledWith("install_update", {
      onProgress: expect.any(tauri.FakeChannel),
    });
    expect(progress).toEqual([
      { downloaded: 1, total: 2 },
      { downloaded: 2, total: 2 },
    ]);
  });

  it("keeps the path of a failed rollback", async () => {
    tauri.invoke.mockRejectedValue({
      kind: "rollbackFailed",
      message: "could not restore",
      path: "C:\\Belegwerk\\belegwerk.exe.old",
    });
    await expect(createTauriUpdater().install(() => {})).rejects.toMatchObject({
      kind: "rollbackFailed",
      path: "C:\\Belegwerk\\belegwerk.exe.old",
    });
  });

  it("reports a failed install with the host's kind", async () => {
    tauri.invoke.mockRejectedValue({ kind: "checksumMismatch", message: "SHA-256 differs" });
    await expect(createTauriUpdater().install(() => {})).rejects.toMatchObject({
      kind: "checksumMismatch",
    });
  });

  it("opens release pages of the repository only", async () => {
    const updater = createTauriUpdater();
    await updater.openReleasePage(RELEASE_URL);
    expect(tauri.openUrl).toHaveBeenCalledWith(RELEASE_URL);
    await expect(updater.openReleasePage("https://example.com/releases/")).rejects.toThrow(
      /Not a release page/,
    );
    expect(tauri.openUrl).toHaveBeenCalledTimes(1);
  });
});

describe("toUpdateError", () => {
  it.each([
    ["a string (IPC error)", "command install_update not allowed"],
    ["an Error", new Error("boom")],
    ["an unknown kind", { kind: "somethingNew", message: "x" }],
    ["undefined", undefined],
  ])("makes %s unexpected", (_, error) => {
    expect(toUpdateError(error).kind).toBe("unexpected");
  });

  it("keeps an UpdateError", () => {
    const error = new UpdateError("devBuild", "debug");
    expect(toUpdateError(error)).toBe(error);
  });
});

describe("parseUpdateCheck", () => {
  it.each([
    ["null", null],
    ["missing fields", { currentVersion: "2026-11-01-0930" }],
    ["a string flag", { ...CHECK, updateAvailable: "yes" }],
  ])("refuses %s", (_, value) => {
    expect(() => parseUpdateCheck(value)).toThrow(UpdateError);
  });

  it("keeps only the known fields", () => {
    expect(parseUpdateCheck({ ...CHECK, extra: 1 })).toEqual(CHECK);
  });
});
