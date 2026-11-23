/**
 * Query object of the booking search (#21): what the booking list (filters
 * and URL search params #22, sorting and pages #23, CSV export #24) asks
 * for. {@link normalizeBookingQuery} validates it – it comes from user input
 * and URLs – and turns it into the repository's filter, sort order and page.
 */
import { parseIsoDate } from "../format";
import type { BookingSource, BookingType, VatRate } from "../model";
import { isVatRate } from "../money";
import type { BookingFilter, BookingSort, BookingSortField, SortDirection } from "../repositories";
import { isId, trimText } from "../validation";

export const DEFAULT_BOOKING_PAGE_SIZE = 100;
/** Largest page size; for every matching booking (CSV export, #24) use `pageSize: "all"`. */
export const MAX_BOOKING_PAGE_SIZE = 500;
/**
 * Longest search text (after trimming, UTF-16 code units). A search box
 * needs far less; the limit keeps the SQL pattern small.
 */
export const BOOKING_SEARCH_TEXT_MAX_LENGTH = 200;

/**
 * Most categories a query may filter by (after removing duplicates) – far
 * more than a business has, and far below SQLite's parameter limit.
 */
export const MAX_BOOKING_QUERY_CATEGORY_IDS = 500;

/** Newest first – the booking list's default (#17). */
export const DEFAULT_BOOKING_SORT: BookingSort = { field: "date", direction: "desc" };

const SORT_FIELDS: Readonly<Record<BookingSortField, true>> = {
  date: true,
  description: true,
  counterparty: true,
  category: true,
  netCents: true,
  vatCents: true,
  grossCents: true,
  type: true,
  source: true,
};

export const BOOKING_SORT_FIELDS = Object.keys(SORT_FIELDS) as readonly BookingSortField[];
export const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

const BOOKING_TYPES: readonly BookingType[] = ["income", "expense"];
const BOOKING_SOURCES: readonly BookingSource[] = ["manual", "stripe"];

/**
 * Search, filter, sort order and page of the booking list. Every property
 * is optional; an absent one (or a blank text/date, or an empty
 * `categoryIds`) does not filter. All filters combine with AND.
 */
export interface BookingQuery {
  /**
   * Searched in description, counterparty, reference and note: substring,
   * case-insensitive (also umlauts: "müller" finds "MÜLLER"), no wildcards.
   * Trimmed; blank = no text filter.
   */
  readonly text?: string;
  /** Payment date from (`YYYY-MM-DD`, inclusive). */
  readonly dateFrom?: string;
  /** Payment date to (`YYYY-MM-DD`, inclusive). */
  readonly dateTo?: string;
  readonly type?: BookingType;
  /** Any of these categories. Empty = all categories; duplicates are ignored. */
  readonly categoryIds?: readonly number[];
  readonly source?: BookingSource;
  /**
   * Any of these VAT rates; `null` = bookings without a rate (#26, drill-down
   * from the EÜR). Empty = all rates; duplicates are ignored.
   */
  readonly vatRates?: readonly (VatRate | null)[];
  /** Gross amount from (integer cents ≥ 0, inclusive). */
  readonly amountFrom?: number;
  /** Gross amount to (integer cents ≥ 0, inclusive). */
  readonly amountTo?: number;
  /** Default: date descending ({@link DEFAULT_BOOKING_SORT}); ties see `BookingSort`. */
  readonly sort?: BookingSort;
  /** 1-based; default 1. A page after the last gives the last page. */
  readonly page?: number;
  /**
   * 1–{@link MAX_BOOKING_PAGE_SIZE}, default {@link DEFAULT_BOOKING_PAGE_SIZE};
   * `"all"` returns every matching booking on one page (CSV export, #24).
   */
  readonly pageSize?: number | "all";
}

/** Error codes per query property. At most one error is reported per property. */
export interface BookingQueryErrorCodes {
  /**
   * `tooLong`: more than {@link BOOKING_SEARCH_TEXT_MAX_LENGTH} characters;
   * `invalidText`: contains a control character (`\p{Cc}`, e.g. NUL – SQLite's
   * GLOB would end the pattern there – tab or line break) or a lone UTF-16
   * surrogate (not a valid character).
   */
  readonly text: "tooLong" | "invalidText";
  readonly dateFrom: "invalidDate";
  /** `dateRangeInverted`: `dateTo` is before `dateFrom` (not swapped silently). */
  readonly dateTo: "invalidDate" | "dateRangeInverted";
  readonly type: "invalidType";
  /**
   * `invalidCategoryId`: some id is not a positive integer; `tooMany`: more
   * than {@link MAX_BOOKING_QUERY_CATEGORY_IDS} distinct ids.
   */
  readonly categoryIds: "invalidCategoryId" | "tooMany";
  readonly source: "invalidSource";
  /** `invalidVatRate`: some value is neither a known `VatRate` nor `null`. */
  readonly vatRates: "invalidVatRate";
  /** `invalidAmount`: not an integer number of cents ≥ 0. */
  readonly amountFrom: "invalidAmount";
  /** `amountRangeInverted`: `amountTo` is below `amountFrom`. */
  readonly amountTo: "invalidAmount" | "amountRangeInverted";
  readonly sort: "invalidSort";
  /** Not a positive integer. */
  readonly page: "invalidPage";
  /** Neither `"all"` nor an integer in 1–{@link MAX_BOOKING_PAGE_SIZE}. */
  readonly pageSize: "invalidPageSize";
}

export type BookingQueryField = keyof BookingQueryErrorCodes;

export type BookingQueryError = {
  readonly [F in BookingQueryField]: {
    readonly field: F;
    readonly code: BookingQueryErrorCodes[F];
  };
}[BookingQueryField];

export type BookingQueryInvalid = {
  readonly ok: false;
  readonly reason: "invalid";
  /** All errors (at most one per property), in the order of {@link BookingQuery}. */
  readonly errors: readonly BookingQueryError[];
};

export interface NormalizedBookingQuery {
  readonly filter: BookingFilter;
  readonly sort: BookingSort;
  readonly page: number;
  readonly pageSize: number | "all";
}

export type NormalizeBookingQueryResult =
  | { readonly ok: true; readonly query: NormalizedBookingQuery }
  | BookingQueryInvalid;

/**
 * Validates `query` and applies the defaults. Invalid input – e.g. a
 * manipulated URL – is reported as result with codes per property, not
 * corrected silently (no swapping of inverted ranges, no clamping of page
 * sizes). Programmer errors like a non-string text throw.
 *
 * Normalization: text trimmed (`trimText`) and NFC-normalized (so a
 * decomposed "ü" typed somewhere still finds the usual composed one);
 * blank texts and dates and an empty `categoryIds`/`vatRates` are dropped;
 * category ids and VAT rates deduplicated. Control characters and lone surrogates inside the text
 * are rejected (`invalidText`), not stripped: a search box cannot produce
 * them, so they mean a manipulated URL or a bug.
 */
export function normalizeBookingQuery(query: BookingQuery = {}): NormalizeBookingQueryResult {
  const errors: BookingQueryError[] = [];
  const filter: { -readonly [K in keyof BookingFilter]: BookingFilter[K] } = {};

  if (query.text !== undefined) {
    const text = trimText(query.text).normalize("NFC");
    if (INVALID_TEXT_CHARACTER.test(text)) {
      errors.push({ field: "text", code: "invalidText" });
    } else if (text.length > BOOKING_SEARCH_TEXT_MAX_LENGTH) {
      errors.push({ field: "text", code: "tooLong" });
    } else if (text !== "") {
      filter.text = text;
    }
  }

  const dateFrom = optionalDate(query.dateFrom);
  const dateTo = optionalDate(query.dateTo);
  if (dateFrom === null) errors.push({ field: "dateFrom", code: "invalidDate" });
  else if (dateFrom !== undefined) filter.dateFrom = dateFrom;
  if (dateTo === null) {
    errors.push({ field: "dateTo", code: "invalidDate" });
  } else if (dateTo !== undefined) {
    // ISO dates compare correctly as strings.
    if (dateFrom && dateTo < dateFrom) errors.push({ field: "dateTo", code: "dateRangeInverted" });
    else filter.dateTo = dateTo;
  }

  if (query.type !== undefined) {
    if (BOOKING_TYPES.includes(query.type)) filter.type = query.type;
    else errors.push({ field: "type", code: "invalidType" });
  }

  if (query.categoryIds !== undefined) {
    const categoryIds = [...new Set(query.categoryIds)];
    if (!categoryIds.every(isId)) {
      errors.push({ field: "categoryIds", code: "invalidCategoryId" });
    } else if (categoryIds.length > MAX_BOOKING_QUERY_CATEGORY_IDS) {
      errors.push({ field: "categoryIds", code: "tooMany" });
    } else if (categoryIds.length > 0) {
      filter.categoryIds = categoryIds;
    }
  }

  if (query.source !== undefined) {
    if (BOOKING_SOURCES.includes(query.source)) filter.source = query.source;
    else errors.push({ field: "source", code: "invalidSource" });
  }

  if (query.vatRates !== undefined) {
    const vatRates = [...new Set(query.vatRates)];
    if (!vatRates.every((rate) => rate === null || isVatRate(rate))) {
      errors.push({ field: "vatRates", code: "invalidVatRate" });
    } else if (vatRates.length > 0) {
      filter.vatRates = vatRates;
    }
  }

  const { amountFrom, amountTo } = query;
  if (amountFrom !== undefined) {
    if (isAmount(amountFrom)) filter.amountFrom = amountFrom;
    else errors.push({ field: "amountFrom", code: "invalidAmount" });
  }
  if (amountTo !== undefined) {
    if (!isAmount(amountTo)) errors.push({ field: "amountTo", code: "invalidAmount" });
    else if (filter.amountFrom !== undefined && amountTo < filter.amountFrom) {
      errors.push({ field: "amountTo", code: "amountRangeInverted" });
    } else {
      filter.amountTo = amountTo;
    }
  }

  const sort = query.sort ?? DEFAULT_BOOKING_SORT;
  const sortValid =
    Object.hasOwn(SORT_FIELDS, sort.field) && SORT_DIRECTIONS.includes(sort.direction);
  if (!sortValid) errors.push({ field: "sort", code: "invalidSort" });

  const page = query.page ?? 1;
  if (!(Number.isSafeInteger(page) && page >= 1))
    errors.push({ field: "page", code: "invalidPage" });
  const pageSize = query.pageSize ?? DEFAULT_BOOKING_PAGE_SIZE;
  if (
    pageSize !== "all" &&
    !(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= MAX_BOOKING_PAGE_SIZE)
  ) {
    errors.push({ field: "pageSize", code: "invalidPageSize" });
  }

  if (errors.length > 0) return { ok: false, reason: "invalid", errors };
  return {
    ok: true,
    query: { filter, sort: { field: sort.field, direction: sort.direction }, page, pageSize },
  };
}

/**
 * Control characters (NUL, tab, line breaks, …) and lone surrogates; with
 * the `u` flag, a valid surrogate pair is one code point and not `\p{Cs}`.
 */
const INVALID_TEXT_CHARACTER = /[\p{Cc}\p{Cs}]/u;

/** `undefined`: absent or blank; `null`: invalid. */
function optionalDate(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const date = trimText(value);
  if (date === "") return undefined;
  return parseIsoDate(date) ? date : null;
}

function isAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
