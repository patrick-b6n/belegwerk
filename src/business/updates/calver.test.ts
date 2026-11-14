import { describe, expect, it } from "vitest";

import {
  calVerFromDate,
  calVerFromTag,
  calVerToSemVer,
  compareCalVer,
  displayVersion,
  latestCalVerOfTags,
  parseCalVer,
  semVerToCalVer,
} from "./calver";

/** Numeric comparison of `x.y.z` (what Tauri's and the updater's SemVer do). */
function compareSemVer(a: string, b: string): number {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

describe("calVerToSemVer / semVerToCalVer", () => {
  it.each([
    ["2026-11-14-2000", "2026.1114.2000"],
    ["2026-01-05-0930", "2026.105.930"],
    ["2026-01-01-0000", "2026.101.0"],
    ["2026-12-31-2359", "2026.1231.2359"],
    ["2028-02-29-0001", "2028.229.1"],
  ])("%s ↔ %s", (calVer, semVer) => {
    expect(calVerToSemVer(calVer)).toBe(semVer);
    expect(semVerToCalVer(semVer)).toBe(calVer);
  });

  it("keeps every part of the SemVer within the Windows file version limit", () => {
    const [major, minor, patch] = (calVerToSemVer("9999-12-31-2359") ?? "").split(".").map(Number);
    for (const part of [major, minor, patch]) expect(part).toBeLessThanOrEqual(65535);
  });

  it("keeps the order of the versions", () => {
    const versions = ["2026-01-05-0930", "2026-01-05-0931", "2026-01-06-0000", "2026-10-01-0000"];
    const semVers = versions.map((version) => calVerToSemVer(version) ?? "");
    expect(semVers.toReversed().toSorted(compareSemVer)).toEqual(semVers);
  });

  it.each([
    "2026-13-01-0000",
    "2026-00-10-0000",
    "2026-02-30-0000",
    "2027-02-29-0000",
    "2026-11-14-2400",
    "2026-11-14-2060",
    "2026-11-14-200",
    "2026-11-14",
    "26-11-14-2000",
    "2026.1114.2000",
    "",
  ])("refuses the CalVer %j", (calVer) => {
    expect(calVerToSemVer(calVer)).toBeNull();
    expect(parseCalVer(calVer)).toBeNull();
  });

  it.each(["0.0.0", "0.1.0", "2026.1314.2000", "2026.1114.2460", "2026.01114.2000", "1.2", "x"])(
    "has no CalVer for %j",
    (semVer) => {
      expect(semVerToCalVer(semVer)).toBeNull();
    },
  );
});

describe("calVerFromDate", () => {
  it("uses the local wall-clock time", () => {
    expect(calVerFromDate(new Date(2026, 10, 14, 20, 0, 59))).toBe("2026-11-14-2000");
    expect(calVerFromDate(new Date(2026, 0, 5, 9, 30))).toBe("2026-01-05-0930");
  });
});

describe("calVerFromTag", () => {
  it("takes the CalVer of a release tag", () => {
    expect(calVerFromTag("v2026-11-14-2000")).toBe("2026-11-14-2000");
  });

  it.each(["2026-11-14-2000", "v2026.1114.2000", "v0.2.0", "v2026-11-14-2000-1", "v"])(
    "refuses the tag %j",
    (tag) => {
      expect(calVerFromTag(tag)).toBeNull();
    },
  );
});

describe("compareCalVer", () => {
  it.each([
    ["2026-01-05-0930", "2026-01-05-0931"],
    ["2026-01-31-2359", "2026-02-01-0000"],
    ["2026-09-30-2359", "2026-10-01-0000"],
    ["2026-12-31-2359", "2027-01-01-0000"],
  ])("%s is older than %s", (older, newer) => {
    expect(compareCalVer(older, newer)).toBeLessThan(0);
    expect(compareCalVer(newer, older)).toBeGreaterThan(0);
  });

  it("finds equal versions equal", () => {
    expect(compareCalVer("2026-11-14-2000", "2026-11-14-2000")).toBe(0);
  });

  it("throws for an invalid CalVer", () => {
    expect(() => compareCalVer("2026-13-01-0000", "2026-11-14-2000")).toThrow(/Invalid CalVer/);
  });
});

describe("latestCalVerOfTags", () => {
  it("finds the highest release tag and ignores other tags", () => {
    expect(
      latestCalVerOfTags([
        "v2026-09-30-2359",
        "v0.1.0",
        "v2026-10-01-0000",
        "test",
        "v2026-13-01-0000",
        "v2026-01-05-0930",
      ]),
    ).toBe("2026-10-01-0000");
  });

  it("is null without release tags", () => {
    expect(latestCalVerOfTags([])).toBeNull();
    expect(latestCalVerOfTags(["v0.1.0", "v0.1.1"])).toBeNull();
  });
});

describe("displayVersion", () => {
  it("shows release versions as CalVer and others unchanged", () => {
    expect(displayVersion("2026.1114.2000")).toBe("2026-11-14-2000");
    expect(displayVersion("0.0.0")).toBe("0.0.0");
  });
});
