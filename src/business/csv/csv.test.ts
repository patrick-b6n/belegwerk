import { describe, expect, it } from "vitest";

import { CSV_BOM, csvLiteral, toCsv } from "./csv";

/** The file content without the BOM. */
function body(csv: string): string {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  return csv.slice(CSV_BOM.length);
}

describe("toCsv", () => {
  it("starts with exactly one BOM that encodes as EF BB BF", () => {
    const csv = toCsv([["a"]]);
    expect(csv.indexOf(CSV_BOM)).toBe(0);
    expect(csv.lastIndexOf(CSV_BOM)).toBe(0);
    expect(Array.from(new TextEncoder().encode(csv).subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("gives just the BOM for no rows", () => {
    expect(toCsv([])).toBe(CSV_BOM);
  });

  it("separates fields with semicolons and ends every row with CRLF", () => {
    expect(
      body(
        toCsv([
          ["a", "b", "c"],
          ["1", "2", "3"],
        ]),
      ),
    ).toBe("a;b;c\r\n1;2;3\r\n");
  });

  it("writes null as an empty field and keeps empty strings empty", () => {
    expect(body(toCsv([[null, "x", "", null]]))).toBe(";x;;\r\n");
  });

  it("writes a row without fields as an empty line", () => {
    expect(body(toCsv([[], ["a"]]))).toBe("\r\na\r\n");
  });

  it.each([
    ["a;b", '"a;b"'],
    ['Sag "Hallo"', '"Sag ""Hallo"""'],
    ['"', '""""'],
    ["Zeile 1\nZeile 2", '"Zeile 1\nZeile 2"'],
    ["Zeile 1\r\nZeile 2", '"Zeile 1\r\nZeile 2"'],
    ["Ende\r", '"Ende\r"'],
  ])("quotes %j as %j", (value, expected) => {
    expect(body(toCsv([[value]]))).toBe(`${expected}\r\n`);
  });

  it.each(["Müller GmbH", "Straße, Köln", " Leerzeichen ", "a,b", "50 %", "Mädchen 'ok'"])(
    "writes %j unquoted",
    (value) => {
      expect(body(toCsv([[value]]))).toBe(`${value}\r\n`);
    },
  );

  it("keeps umlauts and other Unicode text unchanged in UTF-8", () => {
    const csv = toCsv([["Äpfel", "Größe", "€", "😀"]]);
    expect(
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(csv)),
    ).toBe(csv);
    expect(body(csv)).toBe("Äpfel;Größe;€;😀\r\n");
  });

  describe("formula injection", () => {
    it.each([
      ["=1+1", "'=1+1"],
      ["+49 30 123", "'+49 30 123"],
      ["-Rabatt", "'-Rabatt"],
      ["@SUM(A1)", "'@SUM(A1)"],
      ["\tTab", "'\tTab"],
      ['=HYPERLINK("http://x";"y")', '"\'=HYPERLINK(""http://x"";""y"")"'],
    ])("guards text %j as %j", (value, expected) => {
      expect(body(toCsv([[value]]))).toBe(`${expected}\r\n`);
    });

    it("guards a text starting with CR and quotes it", () => {
      expect(body(toCsv([["\r=1"]]))).toBe('"\'\r=1"\r\n');
    });

    it.each(["a=b", "Summe -5", " =1", "'=1"])("leaves %j alone (not at the start)", (value) => {
      expect(body(toCsv([[value]]))).toBe(`${value}\r\n`);
    });

    it("writes literals (app-formatted amounts, dates) unchanged", () => {
      expect(body(toCsv([[csvLiteral("-12,50"), csvLiteral("07.03.2025")]]))).toBe(
        "-12,50;07.03.2025\r\n",
      );
    });

    it("still quotes literals that need it", () => {
      expect(body(toCsv([[csvLiteral("a;b")]]))).toBe('"a;b"\r\n');
    });
  });
});
