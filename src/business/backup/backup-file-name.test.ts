import { describe, expect, it } from "vitest";

import { backupFileName } from "./backup-file-name";

describe("backupFileName", () => {
  it("names the backup after date and time in Europe/Berlin (CET)", () => {
    expect(backupFileName("belegwerk-backup", new Date("2026-01-05T08:07:00Z"))).toBe(
      "belegwerk-backup-2026-01-05_0907.db",
    );
  });

  it("uses summer time (CEST)", () => {
    expect(backupFileName("belegwerk-backup", new Date("2026-07-01T13:30:59Z"))).toBe(
      "belegwerk-backup-2026-07-01_1530.db",
    );
  });

  it("takes the Berlin date around midnight UTC", () => {
    expect(backupFileName("b", new Date("2025-12-31T23:30:00Z"))).toBe("b-2026-01-01_0030.db");
  });

  it("uses 00 for midnight", () => {
    expect(backupFileName("b", new Date("2026-03-01T23:05:00Z"))).toBe("b-2026-03-02_0005.db");
  });

  it("replaces characters Windows forbids in the base", () => {
    expect(backupFileName('a/b:c*"', new Date("2026-01-05T08:07:00Z"))).toBe(
      "a_b_c__-2026-01-05_0907.db",
    );
  });
});
