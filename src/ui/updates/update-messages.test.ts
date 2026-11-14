import { describe, expect, it } from "vitest";

import { UPDATE_ERROR_KINDS, UpdateError } from "@/business/updates";

import {
  installErrorMessage,
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
    const texts = UPDATE_ERROR_KINDS.map((kind) => updateErrorKindMessage(kind));
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

describe("installErrorMessage", () => {
  const PATH = "C:\\Belegwerk\\belegwerk.exe.old";

  it("adds that the installed version is unchanged", () => {
    const text = installErrorMessage(new UpdateError("checksumMismatch", "differs"));
    expect(text).toContain(updateErrorKindMessage("checksumMismatch"));
    expect(text).toContain("unverändert");
  });

  it("names the file to rename after a failed rollback, without claiming nothing changed", () => {
    const text = installErrorMessage(new UpdateError("rollbackFailed", "x", { path: PATH }));
    expect(text).toContain(PATH);
    expect(text).not.toContain("unverändert");
  });

  it("explains a failed rollback without a path as well", () => {
    const text = installErrorMessage(new UpdateError("rollbackFailed", "x"));
    expect(text).toContain(".old");
    expect(text).not.toContain("unverändert");
  });

  it("does not add the note while another install runs", () => {
    const text = installErrorMessage(new UpdateError("alreadyRunning", "x"));
    expect(text).toBe(updateErrorKindMessage("alreadyRunning"));
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

  it("says the update is being installed once the download is complete", () => {
    const text = installProgressMessage({ downloaded: 100, total: 100 });
    expect(text).toContain("Download abgeschlossen");
    expect(text).not.toContain("%");
  });

  it("has no percentage before the first progress", () => {
    expect(installProgressMessage(null)).not.toContain("%");
  });
});
