import { describe, expect, it } from "vitest";

import { SqlError } from "@/persistence/sql-client";

import { describeError, isDatabaseNotLoaded } from "./startup";

describe("isDatabaseNotLoaded", () => {
  it("recognizes the plugin's error anywhere in the cause chain", () => {
    // As the Tauri client wraps the plugin's plain string rejection.
    const sqlError = new SqlError("database sqlite:belegwerk.db not loaded (SQL: ROLLBACK)", {
      cause: "database sqlite:belegwerk.db not loaded",
    });
    expect(isDatabaseNotLoaded(sqlError)).toBe(true);
    expect(isDatabaseNotLoaded(new Error("Could not open", { cause: sqlError }))).toBe(true);
    expect(isDatabaseNotLoaded("database sqlite:belegwerk.db not loaded")).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isDatabaseNotLoaded(new Error("no such table: bookings"))).toBe(false);
    expect(isDatabaseNotLoaded(new Error("x", { cause: new Error("disk I/O error") }))).toBe(false);
    expect(isDatabaseNotLoaded(undefined)).toBe(false);
  });
});

describe("describeError", () => {
  it("lists the error with all causes", () => {
    const error = new Error("outer", { cause: new SqlError("inner", { cause: "raw" }) });
    expect(describeError(error)).toBe("Error: outer\nSqlError: inner\nraw");
  });
});
