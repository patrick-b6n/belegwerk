/**
 * Pure logic of the category management (#19): grouping of the list, the
 * EÜR position options of the form, form values, conversion to the service
 * input and client-side checks. No React, so it is unit-tested in Node.
 *
 * The business layer is the source of truth (`CategoryService`,
 * `validateCategoryPosition`): the position options are derived from
 * `validateCategoryPosition` itself, so the form only offers combinations the
 * service accepts; the client-side checks only cover what the form can tell
 * without the database (name required/too long, position chosen).
 */
import {
  CATEGORY_NAME_MAX_LENGTH,
  type CategoryField,
  type CategoryFieldError,
  type CategoryFormChanges,
  type CategoryFormInput,
  type CategoryWithUsage,
} from "@/business/categories";
import { EUER_POSITIONS, type EuerPosition, validateCategoryPosition } from "@/business/euer";
import type { BookingType } from "@/business/model";
import { trimText } from "@/business/validation";

/** Order of the groups on the page. */
export const CATEGORY_TYPES: readonly BookingType[] = ["income", "expense"];

/** The categories of one type: active ones and archived ones, each sorted by name (de). */
export interface CategoryGroup {
  readonly type: BookingType;
  readonly active: readonly CategoryWithUsage[];
  readonly archived: readonly CategoryWithUsage[];
}

function byName(a: CategoryWithUsage, b: CategoryWithUsage): number {
  return a.name.localeCompare(b.name, "de");
}

/** Groups the categories by type (income first), split into active and archived. */
export function groupCategories(categories: readonly CategoryWithUsage[]): CategoryGroup[] {
  return CATEGORY_TYPES.map((type) => {
    const ofType = categories.filter((category) => category.type === type);
    ofType.sort(byName);
    return {
      type,
      active: ofType.filter((category) => !category.archived),
      archived: ofType.filter((category) => category.archived),
    };
  });
}

/** Number of archived categories (for the "show archived" toggle). */
export function archivedCount(categories: readonly CategoryWithUsage[]): number {
  return categories.filter((category) => category.archived).length;
}

/**
 * Whether "Löschen" is offered: only for non-system categories without
 * bookings (`CategoryService.delete` rejects the others with `systemCategory`
 * or `inUse`).
 */
export function canDelete(category: CategoryWithUsage): boolean {
  return !category.isSystem && category.bookingCount === 0;
}

/** Whether "Archivieren" is offered: active, non-system categories. */
export function canArchive(category: CategoryWithUsage): boolean {
  return !category.isSystem && !category.archived;
}

/**
 * The EÜR positions a category of `type` with the "reduces income" flag may
 * point to, in form order (`EUER_POSITIONS`): every position
 * `validateCategoryPosition` accepts. That is
 *
 * - income: the assignable income positions;
 * - expense: the assignable expense positions;
 * - expense with `reducesIncome`: the turnover positions (lines 15/16) it
 *   reduces.
 *
 * `reducesIncome` is ignored for income categories (the form only shows the
 * flag for expenses). `keep` (e.g. a system category's fixed position) is
 * added in its place in the order if it is a known position but not valid.
 */
export function positionOptions(
  type: BookingType,
  reducesIncome: boolean,
  keep?: string,
): EuerPosition[] {
  const flag = reducesIncome && type === "expense";
  return EUER_POSITIONS.filter(
    (position) =>
      position === keep ||
      validateCategoryPosition({ type, euerPosition: position, reducesIncome: flag }).ok,
  );
}

/**
 * The position after the type or the flag changed: kept if it is still
 * offered, otherwise cleared (`""`).
 */
export function positionAfterChange(
  position: string,
  type: BookingType,
  reducesIncome: boolean,
): string {
  return (positionOptions(type, reducesIncome) as readonly string[]).includes(position)
    ? position
    : "";
}

/** The form's values; the same shape as the service's create input. */
export type CategoryFormValues = CategoryFormInput;

/** Values of a new category of `type`: no name, no position, not reducing income. */
export function newCategoryFormValues(type: BookingType): CategoryFormValues {
  return { name: "", type, euerPosition: "", reducesIncome: false };
}

/** Values of an existing category. */
export function categoryFormValues(category: CategoryWithUsage): CategoryFormValues {
  return {
    name: category.name,
    type: category.type,
    euerPosition: category.euerPosition,
    reducesIncome: category.reducesIncome,
  };
}

/** What the form submits to `CategoryService.create`; the flag only for expenses. */
export function toCreateInput(values: CategoryFormValues): CategoryFormInput {
  return { ...values, reducesIncome: values.type === "expense" && values.reducesIncome };
}

/**
 * What the form submits to `CategoryService.update`. A system category only
 * sends its name (position and flag are fixed and not editable in the form);
 * the type is never sent (it cannot change).
 */
export function toChanges(
  values: CategoryFormValues,
  category: CategoryWithUsage,
): CategoryFormChanges {
  if (category.isSystem) return { name: values.name };
  return {
    name: values.name,
    euerPosition: values.euerPosition,
    reducesIncome: category.type === "expense" && values.reducesIncome,
  };
}

/** Errors the form detects itself, in the service's terms. */
export type CategoryClientError =
  | { readonly field: "name"; readonly code: "required" | "tooLong" }
  | { readonly field: "euerPosition"; readonly code: "required" };

/** Client-side check of the name (trimmed and NFC-normalized like the service does). */
export function checkName(name: string): CategoryClientError | undefined {
  const trimmed = trimText(name).normalize("NFC");
  if (trimmed === "") return { field: "name", code: "required" };
  if (trimmed.length > CATEGORY_NAME_MAX_LENGTH) return { field: "name", code: "tooLong" };
  return undefined;
}

export function checkPosition(position: string): CategoryClientError | undefined {
  return position === "" ? { field: "euerPosition", code: "required" } : undefined;
}

/**
 * Service errors by form field. Every service field is a form field (the
 * type is shown read-only when editing; it cannot fail there).
 */
export function errorsByField(
  errors: readonly CategoryFieldError[],
): ReadonlyMap<CategoryField, CategoryFieldError> {
  return new Map(errors.map((error) => [error.field, error]));
}
