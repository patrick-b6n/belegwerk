import { describe, expect, it } from "vitest";

import { isInDatabaseFolder, normalizeWindowsPath } from "./backup-target";

/** Windows path from `/`-separated segments (keeps the tests readable). */
const win = (path: string) => path.replaceAll("/", "\\");

const FOLDER = win("C:/Users/Jörg/AppData/Roaming/de.belegwerk.desktop");
const DB = `${FOLDER}\\belegwerk.db`;

describe("normalizeWindowsPath", () => {
  it.each([
    ["C:/Users//X\\\\a.db", win("c:/users/x/a.db")],
    [win("C:/Users/X/"), win("c:/users/x")],
    [`\\\\?\\${win("C:/Users/X/a.db")}`, win("c:/users/x/a.db")],
    [win("C:/Users/./X/../Y/a.db"), win("c:/users/y/a.db")],
    [`\\\\${win("server/share/a.db")}`, `\\\\${win("server/share/a.db")}`],
    [`\\\\?\\UNC\\${win("server/share/a.db")}`, `\\\\${win("server/share/a.db")}`],
    [`\\\\.\\UNC\\${win("server/share/a.db")}`, `\\\\${win("server/share/a.db")}`],
    [`\\??\\UNC\\${win("server/share/a.db")}`, `\\\\${win("server/share/a.db")}`],
    [`\\\\.\\${win("C:/Users/X/a.db")}`, win("c:/users/x/a.db")],
    [`\\??\\${win("C:/Users/X/a.db")}`, win("c:/users/x/a.db")],
    [win("C:/Users/X. /Y.../a.db. "), win("c:/users/x/y/a.db")],
  ])("%s → %s", (path, expected) => {
    expect(normalizeWindowsPath(path)).toBe(expected);
  });
});

describe("isInDatabaseFolder", () => {
  it.each([
    ["the database itself", DB],
    ["in other case", DB.toUpperCase()],
    ["with forward slashes", DB.replaceAll("\\", "/")],
    ["with duplicate separators", DB.replace("Roaming\\", "Roaming\\\\")],
    ["with the long-path prefix", `\\\\?\\${DB}`],
    ["with the device prefix \\\\.\\", `\\\\.\\${DB}`],
    ["with the NT prefix \\??\\", `\\??\\${DB}`],
    ["with a trailing dot on the folder", `${FOLDER}.\\belegwerk.db`],
    ["with a trailing space on the folder", `${FOLDER} \\belegwerk.db`],
    ["with trailing dots and spaces on the file", `${DB}. .`],
    ["via ..", win("C:/Users/Jörg/AppData/Roaming/x/../de.belegwerk.desktop/belegwerk.db")],
    ["the journal", `${DB}-journal`],
    ["the WAL", `${DB}-wal`],
    ["the shared memory file", `${DB}-shm`],
    ["any other file in the folder", `${FOLDER}\\backup.db`],
    ["an 8.3 name of the file", `${FOLDER}\\BELEGW~1.DB`],
    ["a file in a subfolder", `${FOLDER}\\sub\\b.db`],
    ["the folder itself", `${FOLDER}\\`],
  ])("refuses %s", (_, target) => {
    expect(isInDatabaseFolder(target, DB)).toBe(true);
  });

  it.each([
    ["the parent folder", win("C:/Users/Jörg/AppData/Roaming/belegwerk.db")],
    ["a sibling folder with the same prefix", `${FOLDER}2\\b.db`],
    ["documents", win("C:/Users/Jörg/Documents/belegwerk-backup.db")],
    ["another drive", `D${FOLDER.slice(1)}\\b.db`],
  ])("allows %s", (_, target) => {
    expect(isInDatabaseFolder(target, DB)).toBe(false);
  });

  it("accepts the database path with the long-path prefix", () => {
    expect(isInDatabaseFolder(DB, `\\\\?\\${DB}`)).toBe(true);
  });

  it("throws for a database path without folder", () => {
    expect(() => isInDatabaseFolder(win("C:/a.db"), "belegwerk.db")).toThrow(/folder/);
  });
});
