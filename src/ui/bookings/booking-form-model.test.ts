import { describe, expect, it } from "vitest";

import type { CategoryWithUsage } from "@/business/categories";
import { parseAmount } from "@/business/format";
import type { Booking } from "@/business/model";

import {
  bookingFormValues,
  categoryAfterTypeChange,
  categoryOptions,
  checkAmount,
  checkCategory,
  checkDate,
  checkRequiredText,
  checkVatRate,
  filterTextSuggestions,
  formatAmountInput,
  isTaxOfficeCategory,
  newBookingFormValues,
  previewAmounts,
  splitServiceErrors,
  taxYearOf,
  toBookingFormInput,
  todayIsoDate,
  vatRateAfterCategoryChange,
} from "./booking-form-model";

const booking: Booking = {
  id: 7,
  date: "2025-03-07",
  type: "expense",
  grossCents: 123456,
  vatRate: "19",
  netCents: 103745,
  vatCents: 19711,
  categoryId: 3,
  description: "Laptop",
  counterparty: "Händler",
  reference: null,
  note: "Notiz",
  source: "stripe",
  externalId: "fee_1",
  createdAt: "2025-03-07T10:00:00.000Z",
  updatedAt: "2025-03-07T10:00:00.000Z",
};

function category(
  id: number,
  name: string,
  type: "income" | "expense",
  archived = false,
): CategoryWithUsage {
  return {
    id,
    name,
    type,
    archived,
    euerPosition: "SONSTIGE_AUSGABEN",
    reducesIncome: false,
    isSystem: false,
    bookingCount: 0,
  };
}

describe("todayIsoDate", () => {
  it("uses the local calendar date", () => {
    expect(todayIsoDate(new Date(2025, 0, 5, 23, 59))).toBe("2025-01-05");
    expect(todayIsoDate(new Date(2025, 11, 31, 0, 0))).toBe("2025-12-31");
  });
});

describe("formatAmountInput", () => {
  it.each([
    [1, "0,01"],
    [29, "0,29"],
    [100, "1,00"],
    [123456, "1.234,56"],
    [10_000_000_000, "100.000.000,00"],
  ])("%i → %s and parses back", (cents, text) => {
    expect(formatAmountInput(cents)).toBe(text);
    expect(parseAmount(text)).toEqual({ ok: true, cents });
  });
});

describe("form values", () => {
  it("starts a new booking with today, expense and 19 %", () => {
    expect(newBookingFormValues("2025-06-01")).toEqual({
      date: "2025-06-01",
      type: "expense",
      amount: "",
      vatRate: "19",
      categoryId: "",
      description: "",
      counterparty: "",
      reference: "",
      note: "",
    });
  });

  it("maps an existing booking", () => {
    expect(bookingFormValues(booking)).toEqual({
      date: "2025-03-07",
      type: "expense",
      amount: "1.234,56",
      vatRate: "19",
      categoryId: "3",
      description: "Laptop",
      counterparty: "Händler",
      reference: "",
      note: "Notiz",
    });
    expect(bookingFormValues({ ...booking, vatRate: null }).vatRate).toBe("");
  });
});

describe("taxYearOf", () => {
  it("is the year of a valid date, otherwise undefined", () => {
    expect(taxYearOf("2025-03-07")).toBe(2025);
    expect(taxYearOf("")).toBeUndefined();
    expect(taxYearOf("2025-02-30")).toBeUndefined();
  });
});

describe("toBookingFormInput", () => {
  const values = bookingFormValues(booking);

  it("converts the values without source and external ID", () => {
    const input = toBookingFormInput(values, false);
    expect(input).toEqual({
      date: "2025-03-07",
      type: "expense",
      grossCents: 123456,
      vatRate: "19",
      categoryId: 3,
      description: "Laptop",
      counterparty: "Händler",
      reference: "",
      note: "Notiz",
    });
    expect("source" in input).toBe(false);
    expect("externalId" in input).toBe(false);
  });

  it("sends no VAT rate in a small business year", () => {
    expect(toBookingFormInput(values, true).vatRate).toBeNull();
  });

  it("passes invalid values on as the service expects them", () => {
    const input = toBookingFormInput(
      { ...values, amount: "x", categoryId: "", vatRate: "" },
      false,
    );
    expect(input.grossCents).toBeNaN();
    expect(input.categoryId).toBeNaN();
    expect(input.vatRate).toBeNull();
  });
});

describe("client-side checks", () => {
  it("requires a date", () => {
    expect(checkDate("")).toEqual({ field: "date", code: "required" });
    expect(checkDate("2025-01-01")).toBeUndefined();
  });

  it("checks the amount text and rejects zero", () => {
    expect(checkAmount("")).toEqual({ field: "amount", code: "empty" });
    expect(checkAmount("12.5")).toEqual({ field: "amount", code: "invalid" });
    expect(checkAmount("1,234")).toEqual({ field: "amount", code: "tooManyDecimals" });
    expect(checkAmount("-1")).toEqual({ field: "amount", code: "negative" });
    expect(checkAmount("100.000.000,01")).toEqual({ field: "amount", code: "tooLarge" });
    expect(checkAmount("0")).toEqual({ field: "amount", code: "amountNotPositive" });
    expect(checkAmount("1.234,56 €")).toBeUndefined();
  });

  it("requires a VAT rate only in regularly taxed years", () => {
    expect(checkVatRate("", false)).toEqual({ field: "vatRate", code: "vatRateRequired" });
    expect(checkVatRate("", true)).toBeUndefined();
    expect(checkVatRate("0", false)).toBeUndefined();
  });

  it("requires a category and visible text", () => {
    expect(checkCategory("")).toEqual({ field: "categoryId", code: "required" });
    expect(checkCategory("1")).toBeUndefined();
    expect(checkRequiredText("description", " ​ ")).toEqual({
      field: "description",
      code: "required",
    });
    expect(checkRequiredText("counterparty", "x")).toBeUndefined();
  });
});

describe("splitServiceErrors", () => {
  it("maps service fields to form fields; source/external ID go to `other`", () => {
    const { byField, other } = splitServiceErrors([
      { field: "grossCents", code: "amountTooLarge" },
      { field: "categoryId", code: "categoryArchived" },
      { field: "externalId", code: "externalIdDuplicate" },
    ]);
    expect([...byField.keys()]).toEqual(["amount", "categoryId"]);
    expect(byField.get("amount")).toEqual({ field: "grossCents", code: "amountTooLarge" });
    expect(other).toEqual([{ field: "externalId", code: "externalIdDuplicate" }]);
  });
});

describe("previewAmounts", () => {
  it("computes net and VAT like the service", () => {
    expect(previewAmounts("119,00", "19", false)).toEqual({
      grossCents: 11900,
      netCents: 10000,
      vatCents: 1900,
    });
    expect(previewAmounts("107", "7", false)).toEqual({
      grossCents: 10700,
      netCents: 10000,
      vatCents: 700,
    });
    expect(previewAmounts("50", "reverse_charge", false)?.vatCents).toBe(0);
  });

  it("ignores the rate in a small business year", () => {
    expect(previewAmounts("119", "19", true)).toEqual({
      grossCents: 11900,
      netCents: 11900,
      vatCents: 0,
    });
  });

  it("is undefined for an invalid amount or a missing rate", () => {
    expect(previewAmounts("", "19", false)).toBeUndefined();
    expect(previewAmounts("0", "19", false)).toBeUndefined();
    expect(previewAmounts("1,234", "19", false)).toBeUndefined();
    expect(previewAmounts("10", "", false)).toBeUndefined();
  });
});

describe("categoryOptions", () => {
  const categories = [
    category(1, "Zubehör", "expense"),
    category(2, "Büro", "expense"),
    category(3, "Alt", "expense", true),
    category(4, "Umsatz", "income"),
    category(5, "Alt-Einnahme", "income", true),
  ];

  it("offers active categories of the type, sorted by name", () => {
    expect(categoryOptions(categories, "expense").map((c) => c.id)).toEqual([2, 1]);
    expect(categoryOptions(categories, "income").map((c) => c.id)).toEqual([4]);
  });

  it("keeps the edited booking's archived category", () => {
    expect(categoryOptions(categories, "expense", [3]).map((c) => c.id)).toEqual([3, 2, 1]);
    // Only for its own type.
    expect(categoryOptions(categories, "income", [3, undefined]).map((c) => c.id)).toEqual([4]);
  });

  it("clears the category when the type changes to one it does not fit", () => {
    const income = categoryOptions(categories, "income");
    expect(categoryAfterTypeChange("2", income)).toBe("");
    expect(categoryAfterTypeChange("4", income)).toBe("4");
    expect(categoryAfterTypeChange("", income)).toBe("");
  });
});

describe("tax-office categories", () => {
  const categories = [
    category(1, "Software", "expense"),
    { ...category(2, "USt-Vorauszahlung", "expense"), euerPosition: "UST_AN_FA" },
    { ...category(3, "USt-Erstattung", "income"), euerPosition: "UST_ERSTATTUNG" },
  ];

  it("recognizes them by position", () => {
    expect(isTaxOfficeCategory("2", categories)).toBe(true);
    expect(isTaxOfficeCategory("3", categories)).toBe(true);
    expect(isTaxOfficeCategory("1", categories)).toBe(false);
    expect(isTaxOfficeCategory("", categories)).toBe(false);
    expect(isTaxOfficeCategory("99", categories)).toBe(false);
  });

  it("sets rate 0 when such a category is chosen, otherwise keeps the rate", () => {
    expect(vatRateAfterCategoryChange("2", categories, "19")).toBe("0");
    expect(vatRateAfterCategoryChange("3", categories, "")).toBe("0");
    expect(vatRateAfterCategoryChange("1", categories, "19")).toBe("19");
    expect(vatRateAfterCategoryChange("", categories, "7")).toBe("7");
  });
});

describe("filterTextSuggestions", () => {
  const suggestions = ["Müller GmbH", "Beratung Müller", "Schmüller", "Telekom", "MÜNZE AG"];

  it("returns all suggestions (up to max) for a blank input", () => {
    expect(filterTextSuggestions(suggestions, "  ")).toEqual(suggestions);
    expect(filterTextSuggestions(suggestions, "", 2)).toEqual(["Müller GmbH", "Beratung Müller"]);
  });

  it("matches substrings ignoring case, also umlauts; word starts first", () => {
    expect(filterTextSuggestions(suggestions, "mü")).toEqual([
      "Müller GmbH",
      "Beratung Müller",
      "MÜNZE AG",
      "Schmüller",
    ]);
    expect(filterTextSuggestions(suggestions, "MÜLL")).toEqual([
      "Müller GmbH",
      "Beratung Müller",
      "Schmüller",
    ]);
    expect(filterTextSuggestions(suggestions, "lek")).toEqual(["Telekom"]);
    expect(filterTextSuggestions(suggestions, "xyz")).toEqual([]);
  });

  it("matches decomposed input", () => {
    expect(filterTextSuggestions(suggestions, "münze")).toEqual(["MÜNZE AG"]);
  });

  it("leaves out a suggestion equal to the input", () => {
    expect(filterTextSuggestions(suggestions, "Telekom ")).toEqual([]);
    expect(filterTextSuggestions(suggestions, "telekom")).toEqual(["Telekom"]);
  });

  it("returns at most max suggestions", () => {
    const many = Array.from({ length: 80 }, (_, index) => `Kunde ${index}`);
    expect(filterTextSuggestions(many, "kunde")).toHaveLength(50);
    expect(filterTextSuggestions(many, "kunde", 3)).toEqual(["Kunde 0", "Kunde 1", "Kunde 2"]);
  });
});
