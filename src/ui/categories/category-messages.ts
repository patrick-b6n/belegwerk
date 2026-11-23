import { CATEGORY_NAME_MAX_LENGTH, type CategoryFieldError } from "@/business/categories";
import { describePosition, isEuerPosition } from "@/business/euer";
import type { BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import { euerPositionName } from "@/ui/euer/position-name";

import type { CategoryClientError } from "./category-model";

export const CATEGORY_GROUP_TITLES: Readonly<Record<BookingType, () => string>> = {
  income: m.categories_group_income,
  expense: m.categories_group_expense,
};

export interface PositionDisplay {
  /** E.g. "Zeile 44 · Telekommunikation", or only the name without a line mapping. */
  readonly text: string;
  readonly name: string;
  readonly line?: number;
  readonly label?: string;
}

/**
 * Display of a category's EÜR position for `year`. A key that is not a known
 * position (the column has no CHECK) shows as "unknown position".
 */
export function positionDisplay(position: string, year: number): PositionDisplay {
  if (!isEuerPosition(position)) {
    const text = m.categories_position_unknown({ position });
    return { text, name: text };
  }
  const name = euerPositionName(position);
  const description = describePosition(position, year);
  if (description.line === undefined) return { text: name, name };
  return {
    text: m.categories_position_with_line({ line: String(description.line), name }),
    name,
    line: description.line,
    label: description.label,
  };
}

const tooLong = () => m.category_error_name_too_long({ max: String(CATEGORY_NAME_MAX_LENGTH) });

export function categoryErrorMessage(error: CategoryFieldError): string {
  switch (error.field) {
    case "name":
      switch (error.code) {
        case "required":
          return m.category_error_name_required();
        case "tooLong":
          return tooLong();
        case "nameDuplicate":
          return m.category_error_name_duplicate();
      }
      break;
    case "type":
      return m.category_error_type_invalid();
    case "euerPosition":
      switch (error.code) {
        case "required":
          return m.category_error_position_required();
        case "unknownPosition":
          return m.category_error_position_unknown();
        case "positionNotAssignable":
          return m.category_error_position_not_assignable();
        case "positionKindMismatch":
          return m.category_error_position_kind_mismatch();
        case "reducesIncomeNeedsIncomePosition":
        case "reducesIncomeNeedsTurnoverPosition":
          return m.category_error_position_reduces_income();
        case "systemCategoryFixed":
          return m.category_error_system_fixed();
      }
      break;
    case "reducesIncome":
      switch (error.code) {
        case "invalidValue":
          return m.category_error_reduces_income_invalid();
        case "reducesIncomeNotExpense":
          return m.category_error_reduces_income_not_expense();
        case "systemCategoryFixed":
          return m.category_error_system_fixed();
      }
      break;
  }
  // Unreachable with the typed codes; a new code without a text is a programmer error.
  throw new Error(`No message for category error ${JSON.stringify(error)}`);
}

export function categoryClientErrorMessage(error: CategoryClientError): string {
  if (error.field === "euerPosition") return m.category_error_position_required();
  return error.code === "required" ? m.category_error_name_required() : tooLong();
}
