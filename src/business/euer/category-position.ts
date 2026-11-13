import type { Category } from "../model";
import { EUER_POSITION_DEFINITIONS, isEuerPosition } from "./positions";

/**
 * Why a category's EÜR position is invalid (codes, translated by the UI):
 *
 * - `unknownPosition`: not a key of `EUER_POSITIONS` (the database has no
 *   CHECK, #13).
 * - `positionNotAssignable`: filled by the EÜR calculation itself (VAT
 *   shares, small-business line).
 * - `positionKindMismatch`: an income category needs an income position, an
 *   expense category an expense position – except Erlösminderung below.
 * - `reducesIncomeNotExpense`: only expense categories reduce income (#1).
 * - `reducesIncomeNeedsIncomePosition`: an Erlösminderung category points to
 *   the income position it reduces.
 */
export type CategoryPositionError =
  | "unknownPosition"
  | "positionNotAssignable"
  | "positionKindMismatch"
  | "reducesIncomeNotExpense"
  | "reducesIncomeNeedsIncomePosition";

export type CategoryPositionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CategoryPositionError };

/**
 * Validates the EÜR position of a category (for the category service, #15).
 *
 * An Erlösminderung category (`reducesIncome`) is an expense category whose
 * `euerPosition` is the **income** position it reduces (e.g.
 * `BETRIEBSEINNAHMEN_UST_PFLICHTIG`); the EÜR calculation (#25) subtracts its
 * amounts there.
 */
export function validateCategoryPosition(
  category: Pick<Category, "type" | "euerPosition" | "reducesIncome">,
): CategoryPositionResult {
  const { type, euerPosition, reducesIncome } = category;
  if (!isEuerPosition(euerPosition)) return { ok: false, error: "unknownPosition" };
  const definition = EUER_POSITION_DEFINITIONS[euerPosition];
  if (!definition.assignable) return { ok: false, error: "positionNotAssignable" };
  if (reducesIncome) {
    if (type !== "expense") return { ok: false, error: "reducesIncomeNotExpense" };
    if (definition.kind !== "income") {
      return { ok: false, error: "reducesIncomeNeedsIncomePosition" };
    }
    return { ok: true };
  }
  if (definition.kind !== type) return { ok: false, error: "positionKindMismatch" };
  return { ok: true };
}
