/**
 * Category service (#15): list, create, edit, archive, reactivate and delete
 * categories with validation. UI and routes use it through `src/app`; it
 * works only against the repository interfaces. Same conventions as the
 * booking service (#14, docs/architecture.md):
 *
 * - Every operation runs in one {@link UnitOfWork.run}; inside the callback
 *   only the callback's repositories are used.
 * - Rule violations are result objects with field-addressable codes (no UI
 *   texts, docs/i18n.md); programmer errors throw.
 *
 * **EÜR position changes apply retroactively.** Bookings store only the
 * category; the EÜR (#25) takes the position and "reduces income" from the
 * category's *current* values. Changing them moves all bookings of the
 * category, also in past years – no booking is rewritten.
 *
 * **System categories** (`isSystem`: USt-Vorauszahlung, USt-Erstattung,
 * Erlösminderung / Rückerstattung) are the categories the VAT logic of the
 * EÜR relies on. They can be renamed, but not archived or deleted, and their
 * EÜR position and "reduces income" flag are fixed. The EÜR identifies them
 * by position and flag, never by name, so a rename is safe.
 */
import { validateCategoryPosition } from "../euer";
import type { BookingType, Category, CategoryChanges } from "../model";
import { ConstraintViolationError, type Repositories, type UnitOfWork } from "../repositories";
import { isId, trimText } from "../validation";

/** What the category form submits on create. */
export interface CategoryFormInput {
  readonly name: string;
  /** Fixed after creation. */
  readonly type: BookingType;
  /** EÜR position key (`EUER_POSITIONS`); `""` = not chosen yet. */
  readonly euerPosition: string;
  /** Erlösminderung: only for expense categories, see `validateCategoryPosition`. */
  readonly reducesIncome: boolean;
}

/**
 * Changes on update; omitted (`undefined`) fields keep their value, so a
 * rename only passes `name`. The type cannot be changed.
 */
export type CategoryFormChanges = Partial<
  Pick<CategoryFormInput, "name" | "euerPosition" | "reducesIncome">
>;

/** Maximum name length after trimming (UTF-16 code units); the form can use it as `maxLength`. */
export const CATEGORY_NAME_MAX_LENGTH = 100;

/** Error codes per field. At most one error is reported per field. */
export interface CategoryFieldErrorCodes {
  /**
   * `required`: blank; `tooLong`: above {@link CATEGORY_NAME_MAX_LENGTH};
   * `nameDuplicate`: another category of the same type (archived ones
   * included) has this name, ignoring case (German locale, incl. umlauts).
   */
  readonly name: "required" | "tooLong" | "nameDuplicate";
  readonly type: "invalidType";
  /**
   * `required`: not chosen (blank); `systemCategoryFixed`: a system
   * category's position cannot change; the others are the
   * `validateCategoryPosition` codes about the position.
   */
  readonly euerPosition:
    | "required"
    | "unknownPosition"
    | "positionNotAssignable"
    | "positionKindMismatch"
    | "reducesIncomeNeedsIncomePosition"
    | "reducesIncomeNeedsTurnoverPosition"
    | "systemCategoryFixed";
  /**
   * `invalidValue`: not a boolean (checked at runtime like `type`);
   * `reducesIncomeNotExpense`: only expense categories reduce income;
   * `systemCategoryFixed`: a system category's flag cannot change.
   */
  readonly reducesIncome: "invalidValue" | "reducesIncomeNotExpense" | "systemCategoryFixed";
}

export type CategoryField = keyof CategoryFieldErrorCodes;

export type CategoryErrorCode = CategoryFieldErrorCodes[CategoryField];

/** A validation error at a form field. */
export type CategoryFieldError = {
  readonly [F in CategoryField]: { readonly field: F; readonly code: CategoryFieldErrorCodes[F] };
}[CategoryField];

/** A category with the number of bookings using it (e.g. to offer delete only when unused). */
export interface CategoryWithUsage extends Category {
  readonly bookingCount: number;
}

export type CategoryNotFound = { readonly ok: false; readonly reason: "notFound" };

export type CategoryInvalid = {
  readonly ok: false;
  readonly reason: "invalid";
  /** All field errors (at most one per field), in the order name, type, euerPosition, reducesIncome. */
  readonly errors: readonly CategoryFieldError[];
};

/** System categories cannot be archived or deleted. */
export type CategoryIsSystem = { readonly ok: false; readonly reason: "systemCategory" };

/** Bookings use the category: it cannot be deleted (archive it instead). */
export type CategoryInUse = {
  readonly ok: false;
  readonly reason: "inUse";
  readonly bookingCount: number;
};

export type GetCategoryResult =
  | { readonly ok: true; readonly category: Category }
  | CategoryNotFound;

export type CreateCategoryResult =
  | { readonly ok: true; readonly category: Category }
  | CategoryInvalid;

export type UpdateCategoryResult =
  | { readonly ok: true; readonly category: Category }
  | CategoryInvalid
  | CategoryNotFound;

/** Archive and reactivate are idempotent. */
export type SetCategoryArchivedResult =
  | { readonly ok: true; readonly category: Category }
  | CategoryNotFound
  | CategoryIsSystem;

export type DeleteCategoryResult =
  | { readonly ok: true }
  | CategoryNotFound
  | CategoryIsSystem
  | CategoryInUse;

export interface CategoryService {
  /**
   * All categories including archived ones, ordered by id, each with its
   * booking count. Grouping (income/expense) and filtering (e.g. without
   * archived ones for the booking form) is up to the caller.
   */
  list(): Promise<CategoryWithUsage[]>;
  get(id: number): Promise<GetCategoryResult>;
  /** New categories are neither archived nor system categories. */
  create(input: CategoryFormInput): Promise<CreateCategoryResult>;
  /** Rename, change the EÜR position (retroactively) or "reduces income". Archived ones too. */
  update(id: number, changes: CategoryFormChanges): Promise<UpdateCategoryResult>;
  /** Archived categories stay valid for their bookings but cannot be chosen for new ones. */
  archive(id: number): Promise<SetCategoryArchivedResult>;
  reactivate(id: number): Promise<SetCategoryArchivedResult>;
  /** Only unused, non-system categories. */
  delete(id: number): Promise<DeleteCategoryResult>;
}

export interface CategoryServiceDependencies {
  readonly unitOfWork: UnitOfWork;
}

const BOOKING_TYPES: readonly BookingType[] = ["income", "expense"];

export function createCategoryService({
  unitOfWork,
}: CategoryServiceDependencies): CategoryService {
  return {
    list: () =>
      unitOfWork.run(async (repos) => {
        const categories = await repos.categories.list();
        const counts = await repos.bookings.countByCategories();
        return categories.map((category) => ({
          ...category,
          bookingCount: counts.get(category.id) ?? 0,
        }));
      }),

    get: async (id) => {
      if (!isId(id)) return NOT_FOUND;
      return unitOfWork.run(async (repos) => {
        const category = await repos.categories.findById(id);
        return category ? { ok: true, category } : NOT_FOUND;
      });
    },

    create: (input) =>
      save(async (repos) => {
        const errors: CategoryFieldError[] = [];
        const name = await validateName(repos, input.name, input.type, undefined, errors);
        const typeValid = BOOKING_TYPES.includes(input.type);
        if (!typeValid) errors.push({ field: "type", code: "invalidType" });
        const { euerPosition } = input;
        const reducesIncome = validateFlag(input.reducesIncome, errors);
        validatePosition(typeValid ? input.type : undefined, euerPosition, reducesIncome, errors);
        sortErrors(errors);
        if (errors.length > 0) return invalid(errors);
        const category = await repos.categories.insert({
          name,
          type: input.type,
          euerPosition,
          reducesIncome: reducesIncome ?? false,
          isSystem: false,
        });
        return { ok: true, category };
      }),

    update: async (id, changes) => {
      if (!isId(id)) return NOT_FOUND;
      return save(async (repos) => {
        const existing = await repos.categories.findById(id);
        if (!existing) return NOT_FOUND;
        const errors: CategoryFieldError[] = [];
        const validated: { -readonly [K in keyof CategoryChanges]: CategoryChanges[K] } = {};

        if (changes.name !== undefined) {
          validated.name = await validateName(
            repos,
            changes.name,
            existing.type,
            existing.id,
            errors,
          );
        }

        const flagValid =
          changes.reducesIncome === undefined ||
          validateFlag(changes.reducesIncome, errors) !== undefined;
        const positionChanged =
          changes.euerPosition !== undefined && changes.euerPosition !== existing.euerPosition;
        const flagChanged =
          flagValid &&
          changes.reducesIncome !== undefined &&
          changes.reducesIncome !== existing.reducesIncome;
        if (existing.isSystem) {
          if (positionChanged) errors.push({ field: "euerPosition", code: "systemCategoryFixed" });
          if (flagChanged) errors.push({ field: "reducesIncome", code: "systemCategoryFixed" });
        } else if (flagValid && (positionChanged || flagChanged)) {
          // Only validated when changed: a rename never fails on the position.
          validated.euerPosition = changes.euerPosition ?? existing.euerPosition;
          validated.reducesIncome = changes.reducesIncome ?? existing.reducesIncome;
          validatePosition(existing.type, validated.euerPosition, validated.reducesIncome, errors);
        }

        sortErrors(errors);
        if (errors.length > 0) return invalid(errors);
        const category = await repos.categories.update(id, validated);
        // Cannot happen inside the transaction; a programmer error otherwise.
        if (!category) throw new Error(`Category ${id} vanished during the update`);
        return { ok: true, category };
      });
    },

    archive: (id) => setArchived(id, true),
    reactivate: (id) => setArchived(id, false),

    delete: async (id) => {
      if (!isId(id)) return NOT_FOUND;
      try {
        return await unitOfWork.run(async (repos): Promise<DeleteCategoryResult> => {
          const existing = await repos.categories.findById(id);
          if (!existing) return NOT_FOUND;
          if (existing.isSystem) return SYSTEM_CATEGORY;
          const bookingCount = await repos.bookings.countByCategory(id);
          if (bookingCount > 0) return { ok: false, reason: "inUse", bookingCount };
          return (await repos.categories.delete(id)) ? { ok: true } : NOT_FOUND;
        });
      } catch (error) {
        // A booking created concurrently (only possible through a bug): the
        // unit of work has rolled back; report the current usage.
        if (error instanceof ConstraintViolationError && error.kind === "foreign_key") {
          const count = await unitOfWork.run((repos) => repos.bookings.countByCategory(id));
          // The violation proves at least one booking, even if it is gone again.
          return { ok: false, reason: "inUse", bookingCount: Math.max(1, count) };
        }
        throw error;
      }
    },
  };

  async function setArchived(id: number, archived: boolean): Promise<SetCategoryArchivedResult> {
    if (!isId(id)) return NOT_FOUND;
    return unitOfWork.run(async (repos) => {
      const existing = await repos.categories.findById(id);
      if (!existing) return NOT_FOUND;
      if (existing.archived === archived) return { ok: true, category: existing };
      // Reactivating is always allowed (a system category is never archived anyway).
      if (archived && existing.isSystem) return SYSTEM_CATEGORY;
      const category = await repos.categories.setArchived(id, archived);
      if (!category) throw new Error(`Category ${id} vanished while archiving`);
      return { ok: true, category };
    });
  }

  /**
   * Runs a write in a unit of work and maps a unique violation (the name
   * check beforehand only misses it through a bug or a concurrent write) to
   * a field error. The unit of work has rolled back.
   */
  async function save<R>(fn: (repos: Repositories) => Promise<R>): Promise<R | CategoryInvalid> {
    try {
      return await unitOfWork.run(fn);
    } catch (error) {
      if (error instanceof ConstraintViolationError && error.kind === "unique") {
        return invalid([{ field: "name", code: "nameDuplicate" }]);
      }
      throw error;
    }
  }
}

const NOT_FOUND: CategoryNotFound = { ok: false, reason: "notFound" };
const SYSTEM_CATEGORY: CategoryIsSystem = { ok: false, reason: "systemCategory" };

const FIELD_ORDER: readonly CategoryField[] = ["name", "type", "euerPosition", "reducesIncome"];

/** Puts the errors into form order (the flag's type check runs early). */
function sortErrors(errors: CategoryFieldError[]): void {
  errors.sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
}

/**
 * `reducesIncome` must be a real boolean (checked at runtime like `type`,
 * e.g. against a raw form value): anything else is `invalidValue`, and the
 * position is then checked as without the flag. Returns the usable value,
 * `undefined` if invalid.
 */
function validateFlag(value: unknown, errors: CategoryFieldError[]): boolean | undefined {
  if (typeof value === "boolean") return value;
  errors.push({ field: "reducesIncome", code: "invalidValue" });
  return undefined;
}

function invalid(errors: readonly CategoryFieldError[]): CategoryInvalid {
  return { ok: false, reason: "invalid", errors };
}

/** Case-insensitive comparison key: German locale (umlauts, ß), canonical composition. */
function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("de");
}

/**
 * Trims and NFC-normalizes the name (so "Büro" typed with a combining
 * umlaut is the same name) and checks length and uniqueness among the
 * categories of `type` – archived ones included, since the database's
 * unique key includes them. `selfId` is the category being renamed.
 */
async function validateName(
  repos: Repositories,
  value: string,
  type: BookingType,
  selfId: number | undefined,
  errors: CategoryFieldError[],
): Promise<string> {
  const name = trimText(value).normalize("NFC");
  if (name === "") {
    errors.push({ field: "name", code: "required" });
  } else if (name.length > CATEGORY_NAME_MAX_LENGTH) {
    errors.push({ field: "name", code: "tooLong" });
  } else {
    const key = nameKey(name);
    const categories = await repos.categories.list();
    const duplicate = categories.some(
      (category) =>
        category.type === type && category.id !== selfId && nameKey(category.name) === key,
    );
    if (duplicate) errors.push({ field: "name", code: "nameDuplicate" });
  }
  return name;
}

/**
 * Validates position and flag with `validateCategoryPosition`, mapping each
 * code to its field. "Reduces income" on an income category is reported at
 * the flag; the position is then checked as for a plain income category.
 * Without a valid `type` only the type-independent checks run.
 */
function validatePosition(
  type: BookingType | undefined,
  euerPosition: string,
  reducesIncome: boolean | undefined,
  errors: CategoryFieldError[],
): void {
  if (euerPosition === "") {
    errors.push({ field: "euerPosition", code: "required" });
  } else {
    const result = validateCategoryPosition({
      type: type ?? "expense",
      euerPosition,
      reducesIncome: reducesIncome === true && type === "expense",
    });
    const typeIndependent =
      !result.ok &&
      (result.error === "unknownPosition" || result.error === "positionNotAssignable");
    // `reducesIncomeNotExpense` cannot occur: the flag is only passed for expense categories.
    if (!result.ok && result.error !== "reducesIncomeNotExpense" && (type || typeIndependent)) {
      errors.push({ field: "euerPosition", code: result.error });
    }
  }
  if (reducesIncome === true && type === "income") {
    errors.push({ field: "reducesIncome", code: "reducesIncomeNotExpense" });
  }
}
