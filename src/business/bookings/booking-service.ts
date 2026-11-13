/**
 * Booking service (#14): create, update, delete and load single bookings
 * with validation. UI and routes use it through `src/app`; it works only
 * against the repository interfaces.
 *
 * - Every operation runs in one {@link UnitOfWork.run}: validation reads
 *   (category, tax year, existing external IDs) and the write see the same
 *   state, and a failed validation writes nothing. Inside the callback only
 *   the callback's repositories are used (docs/architecture.md – deadlock).
 * - Rule violations from user input are returned as result objects with
 *   field-addressable codes (no UI texts, docs/i18n.md); the form shows them
 *   at the field. Programmer errors (e.g. a non-string description) throw.
 * - Net and VAT are always computed here from gross amount, VAT rate and the
 *   tax status of the date's year; callers never pass them.
 */
import { calculateBookingAmounts, isVatRate, MAX_AMOUNT_CENTS } from "../money";
import { parseIsoDate } from "../format";
import type { Booking, BookingInput, BookingSource, BookingType, VatRate } from "../model";
import { ConstraintViolationError, type Repositories, type UnitOfWork } from "../repositories";

/**
 * What the booking form submits. Amounts are integer cents (gross, #1);
 * net and VAT are computed.
 *
 * All form fields are required properties; `reference` and `note` are
 * cleared with `null` or a blank string, so an update always states them.
 * Only `source` and `externalId` – which the form does not necessarily
 * show – may be omitted (`undefined`): `create` then uses the default
 * (`"manual"`, `null`), `update` keeps the booking's current value, so
 * editing a Stripe booking does not turn it into a manual one. `null` (or a
 * blank string) clears `externalId`.
 *
 * Texts are trimmed (also zero-width characters U+200B–U+200D and U+FEFF at
 * the ends); a text consisting only of such characters counts as blank.
 */
export interface BookingFormInput {
  /** Payment date `YYYY-MM-DD`. */
  readonly date: string;
  readonly type: BookingType;
  readonly grossCents: number;
  /** Required in regularly taxed years, `null` in small business years. */
  readonly vatRate: VatRate | null;
  /** Not yet chosen (e.g. `NaN` from an empty select) → `"required"`. */
  readonly categoryId: number;
  readonly description: string;
  readonly counterparty: string;
  /** `null` or blank clears it. */
  readonly reference: string | null;
  /** `null` or blank clears it. */
  readonly note: string | null;
  /** Informational only (#1). */
  readonly source?: BookingSource;
  /** Informational only; unique per source (database index). */
  readonly externalId?: string | null;
}

/**
 * Maximum lengths (after trimming, in UTF-16 code units like
 * `String#length`). Generous limits that keep absurd input (e.g. a pasted
 * file) out of the database and the table; the form can use them as
 * `maxLength`.
 */
export const BOOKING_TEXT_MAX_LENGTH = {
  description: 500,
  counterparty: 200,
  reference: 200,
  note: 2000,
  externalId: 255,
} as const satisfies Record<string, number>;

/** Error codes per field. At most one error is reported per field. */
export interface BookingFieldErrorCodes {
  /** `required`: empty; `invalidDate`: not an existing `YYYY-MM-DD` in 1000–9999. */
  readonly date: "required" | "invalidDate";
  readonly type: "invalidType";
  /**
   * `amountNotPositive`: ≤ 0; `amountNotInteger`: not an integer number of
   * cents; `amountTooLarge`: above `MAX_AMOUNT_CENTS` (100.000.000,00 €).
   */
  readonly grossCents: "amountNotPositive" | "amountNotInteger" | "amountTooLarge";
  /**
   * `vatRateInvalid`: unknown value; `vatRateNotAllowed`: small business
   * year with a rate; `vatRateRequired`: regularly taxed year without one.
   */
  readonly vatRate: "vatRateInvalid" | "vatRateNotAllowed" | "vatRateRequired";
  /**
   * `required`: no valid id (not a positive integer);
   * `categoryTypeMismatch`: category type ≠ booking type;
   * `categoryArchived`: archived category on a new booking, or switched to
   * on an update.
   */
  readonly categoryId:
    | "required"
    | "categoryNotFound"
    | "categoryTypeMismatch"
    | "categoryArchived";
  readonly description: "required" | "tooLong";
  readonly counterparty: "required" | "tooLong";
  readonly reference: "tooLong";
  readonly note: "tooLong";
  readonly source: "invalidSource";
  /** `externalIdDuplicate`: another booking of the same source has this ID. */
  readonly externalId: "tooLong" | "externalIdDuplicate";
}

export type BookingField = keyof BookingFieldErrorCodes;

export type BookingErrorCode = BookingFieldErrorCodes[BookingField];

/** A validation error at a form field. */
export type BookingFieldError = {
  readonly [F in BookingField]: { readonly field: F; readonly code: BookingFieldErrorCodes[F] };
}[BookingField];

export type BookingNotFound = { readonly ok: false; readonly reason: "notFound" };

export type BookingInvalid = {
  readonly ok: false;
  readonly reason: "invalid";
  /** All field errors (at most one per field), in the order of the form's fields. */
  readonly errors: readonly BookingFieldError[];
};

export type GetBookingResult = { readonly ok: true; readonly booking: Booking } | BookingNotFound;

export type CreateBookingResult = { readonly ok: true; readonly booking: Booking } | BookingInvalid;

export type UpdateBookingResult =
  | { readonly ok: true; readonly booking: Booking }
  | BookingInvalid
  | BookingNotFound;

export type DeleteBookingResult = { readonly ok: true } | BookingNotFound;

export interface BookingService {
  get(id: number): Promise<GetBookingResult>;
  create(input: BookingFormInput): Promise<CreateBookingResult>;
  /** Replaces the booking's fields (see {@link BookingFormInput} for omitted optional ones). */
  update(id: number, input: BookingFormInput): Promise<UpdateBookingResult>;
  delete(id: number): Promise<DeleteBookingResult>;
}

export interface BookingServiceDependencies {
  readonly unitOfWork: UnitOfWork;
}

const BOOKING_TYPES: readonly BookingType[] = ["income", "expense"];
const BOOKING_SOURCES: readonly BookingSource[] = ["manual", "stripe"];

export function createBookingService({ unitOfWork }: BookingServiceDependencies): BookingService {
  return {
    get: async (id) => {
      if (!isId(id)) return NOT_FOUND;
      return unitOfWork.run(async (repos) => {
        const booking = await repos.bookings.findById(id);
        return booking ? { ok: true, booking } : NOT_FOUND;
      });
    },

    create: (input) =>
      save(async (repos) => {
        const validated = await validate(repos, input, undefined);
        if (!validated.ok) return validated;
        return { ok: true, booking: await repos.bookings.insert(validated.input) };
      }),

    update: async (id, input) => {
      if (!isId(id)) return NOT_FOUND;
      return save(async (repos) => {
        const existing = await repos.bookings.findById(id);
        if (!existing) return NOT_FOUND;
        const validated = await validate(repos, input, existing);
        if (!validated.ok) return validated;
        const booking = await repos.bookings.update(id, validated.input);
        // Cannot happen inside the transaction; a programmer error otherwise.
        if (!booking) throw new Error(`Booking ${id} vanished during the update`);
        return { ok: true, booking };
      });
    },

    delete: async (id) => {
      if (!isId(id)) return NOT_FOUND;
      return unitOfWork.run(async (repos) =>
        (await repos.bookings.delete(id)) ? { ok: true } : NOT_FOUND,
      );
    },
  };

  /**
   * Runs a write in a unit of work and maps the constraint errors the
   * validation checks beforehand (only possible through a bug or a
   * concurrent write) to field errors. The unit of work has rolled back.
   */
  async function save<R>(fn: (repos: Repositories) => Promise<R>): Promise<R | BookingInvalid> {
    try {
      return await unitOfWork.run(fn);
    } catch (error) {
      if (error instanceof ConstraintViolationError) {
        switch (error.kind) {
          case "unique":
            return invalid([{ field: "externalId", code: "externalIdDuplicate" }]);
          case "foreign_key":
            return invalid([{ field: "categoryId", code: "categoryNotFound" }]);
          default:
            throw error;
        }
      }
      throw error;
    }
  }
}

const NOT_FOUND: BookingNotFound = { ok: false, reason: "notFound" };

/** Ids are positive integers; anything else (e.g. `NaN` from a route param) cannot exist. */
function isId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

// Zero-width space, non-joiner, joiner and BOM (`String#trim` only removes the BOM).
const EDGE_BLANKS = /^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g;

/** Trims whitespace and zero-width characters at the ends; inner ones stay (e.g. ZWJ in emoji). */
function trimText(value: string): string {
  return value.replaceAll(EDGE_BLANKS, "");
}

function invalid(errors: readonly BookingFieldError[]): BookingInvalid {
  return { ok: false, reason: "invalid", errors };
}

type Validated = { readonly ok: true; readonly input: BookingInput } | BookingInvalid;

/**
 * Validates and normalizes `input` and computes the amounts. `existing` is
 * the booking being updated (`undefined` on create).
 *
 * Normalization: all text fields are trimmed (inner whitespace and line
 * breaks stay as entered); blank optional texts become `null`.
 */
async function validate(
  repos: Repositories,
  input: BookingFormInput,
  existing: Booking | undefined,
): Promise<Validated> {
  const errors: BookingFieldError[] = [];

  // Date
  const date = trimText(input.date);
  const dateParts = date === "" ? undefined : parseIsoDate(date);
  if (date === "") errors.push({ field: "date", code: "required" });
  else if (!dateParts) errors.push({ field: "date", code: "invalidDate" });

  // Type
  const typeValid = BOOKING_TYPES.includes(input.type);
  if (!typeValid) errors.push({ field: "type", code: "invalidType" });

  // Gross amount
  const { grossCents } = input;
  const grossValid =
    Number.isSafeInteger(grossCents) && grossCents > 0 && grossCents <= MAX_AMOUNT_CENTS;
  if (typeof grossCents !== "number" || Number.isNaN(grossCents)) {
    errors.push({ field: "grossCents", code: "amountNotInteger" });
  } else if (grossCents <= 0) {
    errors.push({ field: "grossCents", code: "amountNotPositive" });
  } else if (grossCents > MAX_AMOUNT_CENTS) {
    // Also covers Infinity and unsafe integers.
    errors.push({ field: "grossCents", code: "amountTooLarge" });
  } else if (!grossValid) {
    errors.push({ field: "grossCents", code: "amountNotInteger" });
  }

  // VAT rate: the rule depends on the tax status of the date's year
  // (a year without a record is regularly taxed, #16).
  const { vatRate } = input;
  const vatRateValid = vatRate === null || isVatRate(vatRate);
  let amounts: { netCents: number; vatCents: number } | undefined;
  if (!vatRateValid) {
    errors.push({ field: "vatRate", code: "vatRateInvalid" });
  } else if (dateParts) {
    const taxYear = await repos.taxYears.find(dateParts.year);
    // The rule does not depend on the amount; with an invalid amount (already
    // reported) a placeholder still reports the VAT rate error.
    const result = calculateBookingAmounts(
      grossValid ? grossCents : 1,
      vatRate,
      taxYear?.smallBusiness ?? false,
    );
    if (!result.ok) errors.push({ field: "vatRate", code: result.error });
    else if (grossValid) amounts = { netCents: result.netCents, vatCents: result.vatCents };
  }

  // Category: must exist and match the type. Archived categories are not
  // allowed for new bookings; an update may keep the booking's current
  // (meanwhile archived) category, but not switch to another archived one.
  const categoryIdValid = isId(input.categoryId);
  const category = categoryIdValid ? await repos.categories.findById(input.categoryId) : undefined;
  if (!categoryIdValid) {
    errors.push({ field: "categoryId", code: "required" });
  } else if (!category) {
    errors.push({ field: "categoryId", code: "categoryNotFound" });
  } else if (typeValid && category.type !== input.type) {
    errors.push({ field: "categoryId", code: "categoryTypeMismatch" });
  } else if (category.archived && category.id !== existing?.categoryId) {
    errors.push({ field: "categoryId", code: "categoryArchived" });
  }

  // Texts
  const description = requiredText(input.description, "description", errors);
  const counterparty = requiredText(input.counterparty, "counterparty", errors);
  const reference = optionalText(input.reference, "reference", errors);
  const note = optionalText(input.note, "note", errors);

  // Source and external ID: informational only; the external ID is unique
  // per source (database index), checked here for a field error.
  const source = input.source ?? existing?.source ?? "manual";
  const sourceValid = BOOKING_SOURCES.includes(source);
  if (!sourceValid) errors.push({ field: "source", code: "invalidSource" });
  const externalId =
    input.externalId === undefined
      ? (existing?.externalId ?? null)
      : optionalText(input.externalId, "externalId", errors);
  if (
    sourceValid &&
    externalId !== null &&
    externalId.length <= BOOKING_TEXT_MAX_LENGTH.externalId &&
    !(existing && existing.source === source && existing.externalId === externalId)
  ) {
    const found = await repos.bookings.findExistingExternalIds(source, [externalId]);
    if (found.has(externalId)) errors.push({ field: "externalId", code: "externalIdDuplicate" });
  }

  if (errors.length > 0 || !amounts || !category || !dateParts) {
    return invalid(errors);
  }
  return {
    ok: true,
    input: {
      date,
      type: input.type,
      grossCents,
      vatRate,
      netCents: amounts.netCents,
      vatCents: amounts.vatCents,
      categoryId: category.id,
      description,
      counterparty,
      reference,
      note,
      source,
      externalId,
    },
  };
}

function requiredText(
  value: string,
  field: "description" | "counterparty",
  errors: BookingFieldError[],
): string {
  const text = trimText(value);
  if (text === "") errors.push({ field, code: "required" });
  else if (text.length > BOOKING_TEXT_MAX_LENGTH[field]) errors.push({ field, code: "tooLong" });
  return text;
}

/** `null` and blank give `null`. */
function optionalText(
  value: string | null,
  field: "reference" | "note" | "externalId",
  errors: BookingFieldError[],
): string | null {
  const text = value === null ? "" : trimText(value);
  if (text === "") return null;
  if (text.length > BOOKING_TEXT_MAX_LENGTH[field]) errors.push({ field, code: "tooLong" });
  return text;
}
