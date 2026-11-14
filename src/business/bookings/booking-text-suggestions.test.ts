import { describe, expect, it } from "vitest";

import type { BookingTextUsage } from "../repositories";
import { rankBookingTextSuggestions } from "./booking-text-suggestions";

const usage = (
  text: string,
  count: number,
  lastDate: string,
  type: BookingTextUsage["type"] = "income",
): BookingTextUsage => ({ text, type, count, lastDate });

describe("rankBookingTextSuggestions", () => {
  it("returns nothing without usages", () => {
    expect(rankBookingTextSuggestions([], {})).toEqual([]);
  });

  it("orders by number of uses, then most recent date, then alphabetically", () => {
    expect(
      rankBookingTextSuggestions(
        [
          usage("Zeta", 1, "2025-01-01"),
          usage("Alpha", 1, "2025-01-01"),
          usage("Neu", 1, "2025-06-01"),
          usage("Oft", 5, "2020-01-01"),
          usage("Ärger", 1, "2025-01-01"),
        ],
        {},
      ),
    ).toEqual(["Oft", "Neu", "Alpha", "Ärger", "Zeta"]);
  });

  it("merges spellings ignoring case (incl. umlauts) and shows the most used one", () => {
    expect(
      rankBookingTextSuggestions(
        [
          usage("MÜLLER GmbH", 1, "2025-05-01"),
          usage("Müller GmbH", 2, "2025-01-01"),
          usage("müller gmbh", 1, "2025-02-01", "expense"),
          usage("Schmidt", 3, "2025-01-01"),
        ],
        {},
      ),
      // Müller: 4 uses together, ahead of Schmidt (3).
    ).toEqual(["Müller GmbH", "Schmidt"]);
  });

  it("prefers the most recent, then the first spelling by code point on equal uses", () => {
    expect(
      rankBookingTextSuggestions(
        [usage("beratung", 1, "2025-01-01"), usage("Beratung", 1, "2025-02-01")],
        {},
      ),
    ).toEqual(["Beratung"]);
    expect(
      rankBookingTextSuggestions(
        [usage("beratung", 1, "2025-01-01"), usage("Beratung", 1, "2025-01-01")],
        {},
      ),
    ).toEqual(["Beratung"]);
  });

  it("puts texts of the given type first, then those used only with the other type", () => {
    const usages = [
      usage("Kunde A", 1, "2025-01-01", "income"),
      usage("Lieferant", 9, "2025-06-01", "expense"),
      usage("Beides", 1, "2025-01-01", "expense"),
      usage("Beides", 1, "2024-01-01", "income"),
      usage("Kunde B", 3, "2024-01-01", "income"),
    ];
    // "Beides" ranks by its income use only (2024), after "Kunde A" (2025).
    expect(rankBookingTextSuggestions(usages, { type: "income" })).toEqual([
      "Kunde B",
      "Kunde A",
      "Beides",
      "Lieferant",
    ]);
    expect(rankBookingTextSuggestions(usages, { type: "expense" })).toEqual([
      "Lieferant",
      "Beides",
      "Kunde B",
      "Kunde A",
    ]);
    // Without a type, uses of both types add up.
    expect(rankBookingTextSuggestions(usages, {})).toEqual([
      "Lieferant",
      "Kunde B",
      "Beides",
      "Kunde A",
    ]);
  });

  it("matches decomposed and composed umlauts as one text", () => {
    expect(
      rankBookingTextSuggestions(
        [usage("Müller", 1, "2025-01-01"), usage("Müller", 1, "2025-01-01")],
        {},
      ),
    ).toEqual(["Müller"]);
  });

  it("returns at most limit suggestions", () => {
    const usages = Array.from({ length: 10 }, (_, index) =>
      usage(`Text ${index}`, 10 - index, "2025-01-01"),
    );
    expect(rankBookingTextSuggestions(usages, { limit: 3 })).toEqual([
      "Text 0",
      "Text 1",
      "Text 2",
    ]);
  });
});
