import { describe, expect, it } from "vitest";

import { validateCategoryPosition } from "@/business/euer";

import { createTestDb } from "./__tests__/test-db";
import { createRepositories } from "./repositories";

const NOW = new Date("2025-03-07T12:34:56.789Z");

async function seededCategories() {
  const { database } = await createTestDb();
  return createRepositories(database.db, () => NOW).categories.list();
}

describe("default categories (migration 0001_default_categories, #13)", () => {
  it("seeds the default categories", async () => {
    const categories = await seededCategories();
    expect(
      categories.map(({ name, type, euerPosition, reducesIncome, archived, isSystem }) => [
        type,
        name,
        euerPosition,
        reducesIncome,
        archived,
        isSystem,
      ]),
    ).toEqual([
      ["income", "Umsatzerlöse", "BETRIEBSEINNAHMEN_UST_PFLICHTIG", false, false, false],
      [
        "income",
        "Steuerfreie / nicht steuerbare Erlöse",
        "BETRIEBSEINNAHMEN_UST_FREI",
        false,
        false,
        false,
      ],
      ["income", "USt-Erstattung", "UST_ERSTATTUNG", false, false, true],
      ["expense", "Fremdleistungen", "FREMDLEISTUNGEN", false, false, false],
      ["expense", "Geringwertige Wirtschaftsgüter (GWG)", "GWG", false, false, false],
      ["expense", "Miete Geschäftsräume", "MIETE_GESCHAEFTSRAEUME", false, false, false],
      ["expense", "Telefon / Internet", "TELEKOMMUNIKATION", false, false, false],
      ["expense", "Übernachtung / Reisenebenkosten", "REISENEBENKOSTEN", false, false, false],
      ["expense", "Verpflegungsmehraufwand", "VERPFLEGUNGSMEHRAUFWAND", false, false, false],
      ["expense", "Fahrtkosten", "FAHRTKOSTEN", false, false, false],
      ["expense", "Fortbildung", "FORTBILDUNG", false, false, false],
      [
        "expense",
        "Rechts- und Steuerberatung, Buchführung",
        "RECHTS_STEUERBERATUNG",
        false,
        false,
        false,
      ],
      ["expense", "Beiträge / Versicherungen", "BEITRAEGE_VERSICHERUNGEN", false, false, false],
      ["expense", "EDV-Kosten / Software", "EDV_KOSTEN", false, false, false],
      ["expense", "Bürobedarf / Porto / Fachliteratur", "ARBEITSMITTEL", false, false, false],
      ["expense", "Werbung", "WERBUNG", false, false, false],
      ["expense", "Bewirtung", "BEWIRTUNG", false, false, false],
      ["expense", "Bank- und Zahlungsgebühren", "SONSTIGE_AUSGABEN", false, false, false],
      ["expense", "Sonstige Betriebsausgaben", "SONSTIGE_AUSGABEN", false, false, false],
      ["expense", "USt-Vorauszahlung", "UST_AN_FA", false, false, true],
      [
        "expense",
        "Erlösminderung / Rückerstattung",
        "BETRIEBSEINNAHMEN_UST_PFLICHTIG",
        true,
        false,
        true,
      ],
    ]);
  });

  it("uses only valid EÜR positions (cross-check with src/business/euer)", async () => {
    for (const category of await seededCategories()) {
      expect({ name: category.name, result: validateCategoryPosition(category) }).toEqual({
        name: category.name,
        result: { ok: true },
      });
    }
  });

  it("has names that are unique per type ignoring case (as the service compares, #15)", async () => {
    const categories = await seededCategories();
    const keys = categories.map((c) => `${c.type}:${c.name.toLocaleLowerCase("de")}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const category of categories) expect(category.name.trim()).toBe(category.name);
  });
});
