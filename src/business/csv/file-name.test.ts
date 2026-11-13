import { describe, expect, it } from "vitest";

import { csvFileName } from "./file-name";

const words = { base: "buchungen", today: "2026-11-14", fromWord: "ab", toWord: "bis" };

describe("csvFileName", () => {
  it("names the period when both ends are set", () => {
    expect(csvFileName({ ...words, dateFrom: "2025-01-01", dateTo: "2025-12-31" })).toBe(
      "buchungen-2025-01-01_2025-12-31.csv",
    );
  });

  it("names an open end with the given words", () => {
    expect(csvFileName({ ...words, dateFrom: "2025-01-01" })).toBe("buchungen-ab-2025-01-01.csv");
    expect(csvFileName({ ...words, dateTo: "2025-12-31" })).toBe("buchungen-bis-2025-12-31.csv");
  });

  it("uses today without a period", () => {
    expect(csvFileName(words)).toBe("buchungen-2026-11-14.csv");
    expect(csvFileName({ ...words, dateFrom: undefined, dateTo: undefined })).toBe(
      "buchungen-2026-11-14.csv",
    );
  });

  it("replaces characters Windows forbids in file names", () => {
    expect(csvFileName({ ...words, base: 'a<b>c:d"e/f\\g|h?i*j\u0001k' })).toBe(
      "a_b_c_d_e_f_g_h_i_j_k-2026-11-14.csv",
    );
  });
});
