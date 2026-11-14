import { describe, expect, it } from "vitest";

import { UPDATE_ERROR_KINDS, UpdateError } from "@/business/updates";

import {
  installProgressMessage,
  updateCheckMessage,
  updateErrorKindMessage,
  updateErrorMessage,
} from "./update-messages";

const CHECK = {
  currentVersion: "2026-11-01-0930",
  latestVersion: "2026-11-14-2000",
  updateAvailable: true,
  releaseUrl: "https://github.com/patrick-b6n/belegwerk-next/releases/tag/v2026-11-14-2000",
};

describe("updateErrorKindMessage", () => {
  it("has a distinct text for every error kind", () => {
    const texts = UPDATE_ERROR_KINDS.map(updateErrorKindMessage);
    expect(new Set(texts).size).toBe(UPDATE_ERROR_KINDS.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(10);
  });
});

describe("updateErrorMessage", () => {
  it("uses the kind of an UpdateError", () => {
    expect(updateErrorMessage(new UpdateError("network", "offline"))).toBe(
      updateErrorKindMessage("network"),
    );
  });

  it("treats any other error as unexpected", () => {
    expect(updateErrorMessage(new Error("boom"))).toBe(updateErrorKindMessage("unexpected"));
  });
});

describe("updateCheckMessage", () => {
  it("names the new and the installed version", () => {
    const text = updateCheckMessage(CHECK);
    expect(text).toContain("2026-11-14-2000");
    expect(text).toContain("2026-11-01-0930");
  });

  it("says that the app is up to date", () => {
    const text = updateCheckMessage({
      ...CHECK,
      latestVersion: "2026-11-01-0930",
      updateAvailable: false,
    });
    expect(text).toContain("aktuell");
    expect(text).toContain("2026-11-01-0930");
  });
});

describe("installProgressMessage", () => {
  it("shows the percentage while downloading", () => {
    expect(installProgressMessage({ downloaded: 42, total: 100 })).toContain("42 %");
  });

  it("says the app restarts once the download is complete", () => {
    expect(installProgressMessage({ downloaded: 100, total: 100 })).toContain("neu");
  });

  it("has no percentage before the first progress", () => {
    expect(installProgressMessage(null)).not.toContain("%");
  });
});
