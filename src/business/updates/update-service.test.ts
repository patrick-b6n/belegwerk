import { describe, expect, it, vi } from "vitest";

import {
  createUpdateService,
  type DownloadProgress,
  downloadPercent,
  type UpdateCheck,
  UpdateError,
  type Updater,
} from "./update-service";

const CHECK: UpdateCheck = {
  currentVersion: "2026-11-01-0930",
  latestVersion: "2026-11-14-2000",
  updateAvailable: true,
  releaseUrl: "https://github.com/patrick-b6n/belegwerk/releases/tag/v2026-11-14-2000",
};

function fakeUpdater(overrides: Partial<Updater> = {}): Updater {
  return {
    check: async () => CHECK,
    install: async () => {},
    openReleasePage: async () => {},
    ...overrides,
  };
}

describe("createUpdateService", () => {
  it("returns the check result", async () => {
    const service = createUpdateService({ updater: fakeUpdater() });
    await expect(service.check()).resolves.toEqual(CHECK);
    await expect(service.checkInBackground()).resolves.toEqual(CHECK);
  });

  it("passes errors of a manual check on", async () => {
    const error = new UpdateError("network", "offline");
    const service = createUpdateService({
      updater: fakeUpdater({ check: () => Promise.reject(error) }),
    });
    await expect(service.check()).rejects.toBe(error);
  });

  it("only logs errors of the background check", async () => {
    const error = new UpdateError("network", "offline");
    const logError = vi.fn<(message: string, error: unknown) => void>();
    const service = createUpdateService({
      updater: fakeUpdater({ check: () => Promise.reject(error) }),
      logError,
    });
    await expect(service.checkInBackground()).resolves.toBeNull();
    expect(logError).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("forwards the download progress of an install", async () => {
    const service = createUpdateService({
      updater: fakeUpdater({
        install: async (onProgress) => {
          onProgress({ downloaded: 50, total: 100 });
          onProgress({ downloaded: 100, total: 100 });
        },
      }),
    });
    const progress: DownloadProgress[] = [];
    await service.install((value) => progress.push(value));
    expect(progress).toEqual([
      { downloaded: 50, total: 100 },
      { downloaded: 100, total: 100 },
    ]);
  });

  it("opens the release page of the check", async () => {
    const openReleasePage = vi.fn<(url: string) => Promise<void>>(async () => {});
    const service = createUpdateService({ updater: fakeUpdater({ openReleasePage }) });
    await service.openReleaseNotes(CHECK);
    expect(openReleasePage).toHaveBeenCalledWith(CHECK.releaseUrl);
  });
});

describe("downloadPercent", () => {
  it.each([
    [0, 100, 0],
    [1, 3, 33],
    [999, 1000, 99],
    [1000, 1000, 100],
    [2000, 1000, 100],
  ])("%i of %i bytes is %i %%", (downloaded, total, percent) => {
    expect(downloadPercent({ downloaded, total })).toBe(percent);
  });

  it("is null while the size is unknown", () => {
    expect(downloadPercent({ downloaded: 10, total: 0 })).toBeNull();
    expect(downloadPercent({ downloaded: 10, total: Number.NaN })).toBeNull();
  });
});
