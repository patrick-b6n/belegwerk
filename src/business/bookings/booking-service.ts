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
import type {
  Booking,
  BookingInput,
  BookingSource,
  BookingType,
  Category,
  VatRate,
} from "../model";
import { ConstraintViolationError, type Repositories, type UnitOfWork } from "../repositories";
import { isId, trimText } from "../validation";
import {
  type BookingQuery,
  type BookingQueryInvalid,
  normalizeBookingQuery,
} from "./booking-query";

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
 * Texts are trimmed (also invisible format characters like U+200B–U+200D,
 * U+2060, U+00AD and U+FEFF at the ends, see `trimText`); a text without any
 * visible character counts as blank. Description, counterparty, reference
 * and note are stored NFC-normalized (a decomposed "u + U+0308" becomes
 * "ü"), so the search (#21), which normalizes its text the same way, finds
 * them; the external ID stays as given.
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

/** What the booking list shows of a booking's category. */
export type BookingListCategory = Pick<Category, "id" | "name" | "archived">;

/** A booking with the category data the list displays (#17). */
export interface BookingListItem extends Booking {
  readonly category: BookingListCategory;
}

/** Sums of the gross amounts of all bookings matching the query (not just the page). */
export interface BookingSums {
  readonly incomeCents: number;
  readonly expenseCents: number;
  /** Income minus expense; negative for a loss. */
  readonly balanceCents: number;
}

/** Result of {@link BookingService.list}. */
export type BookingListResult =
  | {
      readonly ok: true;
      /** The bookings of the page, in the query's sort order. */
      readonly items: readonly BookingListItem[];
      /** Number of all matching bookings. */
      readonly total: number;
      /**
       * The page returned (1-based): the requested one, or the last page if
       * the requested one is after it (e.g. after deleting its last booking).
       */
      readonly page: number;
      readonly pageSize: number | "all";
      /** At least 1 (an empty result is one empty page); 1 for `pageSize: "all"`. */
      readonly pageCount: number;
      readonly sums: BookingSums;
    }
  | BookingQueryInvalid;

export interface BookingService {
  /**
   * Booking search (#17, #21): one page of the bookings matching `query`,
   * each with its category, plus the total count and the sums of **all**
   * matching bookings. Without a query: the first
   * DEFAULT_BOOKING_PAGE_SIZE bookings, newest first. Invalid input
   * gives `{ ok: false, reason: "invalid", errors }` (see
   * {@link normalizeBookingQuery}).
   */
  list(query?: BookingQuery): Promise<BookingListResult>;
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
    list: async (query) => {
      const normalized = normalizeBookingQuery(query);
      if (!normalized.ok) return normalized;
      const { filter, sort, pageSize } = normalized.query;
      // One unit of work: count, sums and page see the same state.
      return unitOfWork.run(async (repos) => {
        const totals = await repos.bookings.summarize(filter);
        const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(totals.count / pageSize));
        const page = Math.min(normalized.query.page, pageCount);
        const bookings =
          totals.count === 0
            ? []
            : await repos.bookings.search(
                pageSize === "all"
                  ? { filter, sort }
                  : { filter, sort, limit: pageSize, offset: (page - 1) * pageSize },
              );
        // Categories joined here: they are few, and a SQL join would need an
        // explicit select object (duplicate column names, docs/data-model.md).
        const categories = new Map(
          (await repos.categories.list()).map((category) => [category.id, category]),
        );
        const items = bookings.map((booking): BookingListItem => {
          const category = categories.get(booking.categoryId);
          // Foreign key: a booking's category always exists.
          if (!category) {
            throw new Error(`Category ${booking.categoryId} of booking ${booking.id} not found`);
          }
          const { id, name, archived } = category;
          return { ...booking, category: { id, name, archived } };
        });
        return {
          ok: true,
          items,
          total: totals.count,
          page,
          pageSize,
          pageCount,
          sums: {
            incomeCents: totals.incomeCents,
            expenseCents: totals.expenseCents,
            balanceCents: totals.incomeCents - totals.expenseCents,
          },
        };
      });
    },

    get: async (id) => {
      if (!isId(id)) return NOT_FOUND;
      return unitOfWork.run(async (repos) => {
        const booking = await repos.bookings.findById(id);
        return booking ? { ok: true, booking } : NOT_FOUND;
      });
    },

    create: (input) =>
      save(async (repos) => {
        const validated = await prepareBooking(input, repositoryBookingLookups(repos));
        if (!validated.ok) return validated;
        return { ok: true, booking: await repos.bookings.insert(validated.input) };
      }),

    update: async (id, input) => {
      if (!isId(id)) return NOT_FOUND;
      return save(async (repos) => {
        const existing = await repos.bookings.findById(id);
        if (!existing) return NOT_FOUND;
        const validated = await prepareBooking(input, repositoryBookingLookups(repos), existing);
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

function invalid(errors: readonly BookingFieldError[]): BookingInvalid {
  return { ok: false, reason: "invalid", errors };
}

/** Result of {@link prepareBooking}: the row to write, or all field errors. */
export type PrepareBookingResult =
  | { readonly ok: true; readonly input: BookingInput }
  | BookingInvalid;

/**
 * What the booking validation reads. The service passes the repositories of
 * its unit of work ({@link repositoryBookingLookups}); a batch writer such as
 * the Stripe import (#30) passes data it loaded once for the whole batch – in
 * its own unit of work – so the rules stay in one place.
 */
export interface BookingLookups {
  findCategory(id: number): Promise<Category | undefined>;
  /** Tax status of the year; a year without a record is regularly taxed (#16). */
  isSmallBusinessYear(year: number): Promise<boolean>;
  /** Whether another booking of `source` already has `externalId`. */
  externalIdExists(source: BookingSource, externalId: string): Promise<boolean>;
}

/** {@link BookingLookups} reading from the repositories of a unit of work. */
export function repositoryBookingLookups(repos: Repositories): BookingLookups {
  return {
    findCategory: (id) => repos.categories.findById(id),
    isSmallBusinessYear: async (year) => (await repos.taxYears.find(year))?.smallBusiness ?? false,
    externalIdExists: async (source, externalId) =>
      (await repos.bookings.findExistingExternalIds(source, [externalId])).has(externalId),
  };
}

/**
 * Validates and normalizes `input` and computes the amounts
 * (`calculateBookingAmounts`) – the single source of the booking rules, used
 * by `create`/`update` and by the Stripe import (#30). `existing` is the
 * booking being updated (`undefined` on create). Writes nothing.
 *
 * Normalization: all text fields are trimmed (inner whitespace and line
 * breaks stay as entered); blank optional texts become `null`.
 */
export async function prepareBooking(
  input: BookingFormInput,
  lookups: BookingLookups,
  existing?: Booking,
): Promise<PrepareBookingResult> {
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
    const smallBusiness = await lookups.isSmallBusinessYear(dateParts.year);
    // The rule does not depend on the amount; with an invalid amount (already
    // reported) a placeholder still reports the VAT rate error.
    const result = calculateBookingAmounts(grossValid ? grossCents : 1, vatRate, smallBusiness);
    if (!result.ok) errors.push({ field: "vatRate", code: result.error });
    else if (grossValid) amounts = { netCents: result.netCents, vatCents: result.vatCents };
  }

  // Category: must exist and match the type. Archived categories are not
  // allowed for new bookings; an update may keep the booking's current
  // (meanwhile archived) category, but not switch to another archived one.
  const categoryIdValid = isId(input.categoryId);
  const category = categoryIdValid ? await lookups.findCategory(input.categoryId) : undefined;
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
    if (await lookups.externalIdExists(source, externalId))
      errors.push({ field: "externalId", code: "externalIdDuplicate" });
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
  const text = trimText(value).normalize("NFC");
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
  const trimmed = value === null ? "" : trimText(value);
  // IDs of a source system are kept exactly as given.
  const text = field === "externalId" ? trimmed : trimmed.normalize("NFC");
  if (text === "") return null;
  if (text.length > BOOKING_TEXT_MAX_LENGTH[field]) errors.push({ field, code: "tooLong" });
  return text;
}
