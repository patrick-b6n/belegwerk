/**
 * Pure logic of the booking list's filters (#22): the URL search params of
 * `/bookings` (validation, defaults, mapping to the business `BookingQuery`),
 * the period quick picks (year / quarter / month / custom) and the category
 * options. No React, so it is unit-tested in Node.
 *
 * URL schema (all params optional; absent = no filter, defaults never appear
 * in the URL):
 *
 * | Param       | Value                                   | `BookingQuery`  |
 * | ----------- | --------------------------------------- | --------------- |
 * | `q`         | search text                             | `text`          |
 * | `from`/`to` | payment date `YYYY-MM-DD` (inclusive)   | `dateFrom/To`   |
 * | `type`       | `income` \| `expense`               | `type`          |
 * | `category` | category ids (array)                    | `categoryIds`   |
 * | `source`    | `manual` \| `stripe`                   | `source`        |
 * | `vat`       | VAT rates (array of `0`/`7`/`19`/`rc`/`none`, #26) | `vatRates` |
 * | `amountFrom`/`amountTo` | gross amount in **cents**   | `amountFrom/To` |
 * | `sort` | `<column>-<asc|desc>`, e.g. `gross-asc` (#23) | `sort`  |
 * | `page`     | page, 1-based (#23)                     | `page`          |
 * | `pageSize`  | page size, {@link BOOKING_PAGE_SIZES} (#23) | `pageSize`  |
 *
 * The period is stored only as `from`/`to`; the quick pick (year, quarter,
 * month) is derived from them ({@link detectPeriod}), so a URL has exactly
 * one meaning and stays short. The defaults of sort order (`date-desc`), page
 * (1) and page size (50) are not written either.
 *
 * {@link validateBookingSearch} never throws: values that cannot be read
 * (unknown enum value, impossible date, negative or fractional amount, non-id
 * categories) are dropped. Values that are readable but contradict each
 * other (inverted ranges, too long text) are kept, so the filter bar shows
 * the business layer's error (`normalizeBookingQuery`) at the control.
 */
import {
  BOOKING_SORT_FIELDS,
  type BookingQuery,
  type BookingSort,
  type BookingSortField,
  DEFAULT_BOOKING_PAGE_SIZE,
  DEFAULT_BOOKING_SORT,
  type SortDirection,
} from "@/business/bookings";
import type { CategoryWithUsage } from "@/business/categories";
import { parseAmount, parseIsoDate, type ParseAmountError } from "@/business/format";
import type { BookingSource, BookingType, VatRate } from "@/business/model";
import { MAX_AMOUNT_CENTS } from "@/business/money";
import { isId, trimText } from "@/business/validation";

// ---------------------------------------------------------------------------
// URL search params

export type BookingTypeParam = "income" | "expense";
export type BookingSourceParam = "manual" | "stripe";
/** A VAT rate in the URL: `rc` = reverse charge, `none` = no rate (small business). */
export type VatRateParam = "none" | "0" | "7" | "19" | "rc";

/** The validated search params of `/bookings` (absent = no filter). */
export interface BookingSearch {
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
  readonly type?: BookingTypeParam;
  readonly category?: readonly number[];
  readonly source?: BookingSourceParam;
  /** VAT rates (#26, drill-down from the EÜR), in {@link VAT_RATE_PARAMS} order, without duplicates. */
  readonly vat?: readonly VatRateParam[];
  readonly amountFrom?: number;
  readonly amountTo?: number;
  /** Sort order (#23); absent = {@link DEFAULT_BOOKING_SORT} (date descending). */
  readonly sort?: BookingSortParam;
  /** Page (#23), an integer ≥ 2; absent = page 1. */
  readonly page?: number;
  /** Page size (#23), one of {@link BOOKING_PAGE_SIZES} except the default; absent = 100. */
  readonly pageSize?: number;
}

export type BookingSearchKey = keyof BookingSearch;

const TYPE_PARAMS: Readonly<Record<BookingTypeParam, BookingType>> = {
  income: "income",
  expense: "expense",
};
const SOURCE_PARAMS: Readonly<Record<BookingSourceParam, BookingSource>> = {
  manual: "manual",
  stripe: "stripe",
};

export const VAT_RATE_PARAMS: readonly VatRateParam[] = ["none", "0", "7", "19", "rc"];

const VAT_RATE_OF_PARAM: Readonly<Record<VatRateParam, VatRate | null>> = {
  none: null,
  "0": "0",
  "7": "7",
  "19": "19",
  rc: "reverse_charge",
};

export function vatRateParam(rate: VatRate | null): VatRateParam {
  if (rate === null) return "none";
  return rate === "reverse_charge" ? "rc" : rate;
}

export function vatRateOfParam(param: VatRateParam): VatRate | null {
  return VAT_RATE_OF_PARAM[param];
}

/**
 * VAT rate params in {@link VAT_RATE_PARAMS} order without duplicates;
 * `undefined` when empty (no filter).
 */
export function sortedVatRateParams(
  params: readonly VatRateParam[],
): readonly VatRateParam[] | undefined {
  const sorted = VAT_RATE_PARAMS.filter((param) => params.includes(param));
  return sorted.length > 0 ? sorted : undefined;
}

export function typeParam(type: BookingType): BookingTypeParam {
  return type;
}

export function sourceParam(source: BookingSource): BookingSourceParam {
  return source;
}

function isTypeParam(value: unknown): value is BookingTypeParam {
  return typeof value === "string" && Object.hasOwn(TYPE_PARAMS, value);
}

function isSourceParam(value: unknown): value is BookingSourceParam {
  return typeof value === "string" && Object.hasOwn(SOURCE_PARAMS, value);
}

/**
 * A non-negative safe integer from a URL value. The router parses `1000` as
 * number and `"1000"` (quoted) as string; both are accepted.
 */
function nonNegativeInteger(value: unknown): number | undefined {
  let number: number;
  if (typeof value === "number") number = value;
  else if (typeof value === "string" && /^\d+$/.test(value)) number = Number(value);
  else return undefined;
  if (!Number.isSafeInteger(number) || number < 0) return undefined;
  // -0 (from `?amountFrom=-0`) is 0.
  return number === 0 ? 0 : number;
}

/**
 * An amount in cents from a URL value: like the amount inputs (`parseAmount`),
 * at most {@link MAX_AMOUNT_CENTS}; larger amounts are dropped.
 */
function amountCents(value: unknown): number | undefined {
  const cents = nonNegativeInteger(value);
  return cents !== undefined && cents <= MAX_AMOUNT_CENTS ? cents : undefined;
}

/** Category ids from an array, a single number or a comma-separated string. */
function categoryIds(value: unknown): number[] | undefined {
  let raw: unknown[];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === "string") raw = value.split(",");
  else raw = [value];
  const ids: number[] = [];
  for (const item of raw) {
    const id = nonNegativeInteger(typeof item === "string" ? item.trim() : item);
    if (id !== undefined && isId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

/**
 * VAT rates from an array or a single value; the router parses `vat=[19,0]`
 * as numbers and `vat=["rc"]` as strings, both are accepted. Unknown values
 * are dropped.
 */
function vatRateParams(value: unknown): readonly VatRateParam[] | undefined {
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const params = raw
    .map((item) => (typeof item === "number" ? String(item) : item))
    .filter(
      (item): item is VatRateParam =>
        typeof item === "string" && Object.hasOwn(VAT_RATE_OF_PARAM, item),
    );
  return sortedVatRateParams(params);
}

function isoDate(value: unknown): string | undefined {
  return typeof value === "string" && parseIsoDate(value) ? value : undefined;
}

function searchText(value: unknown): string | undefined {
  // `?q=2025` arrives as a number.
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  return typeof text === "string" && trimText(text) !== "" ? text : undefined;
}

// ---------------------------------------------------------------------------
// Sort order and pages (#23)

export type BookingSortFieldParam =
  | "date"
  | "type"
  | "description"
  | "counterparty"
  | "category"
  | "net"
  | "vat"
  | "gross"
  | "source";
export type SortDirectionParam = "asc" | "desc";
/** Value of the `sort` param, e.g. `gross-asc`. */
export type BookingSortParam = `${BookingSortFieldParam}-${SortDirectionParam}`;

const SORT_FIELD_PARAMS: Readonly<Record<BookingSortField, BookingSortFieldParam>> = {
  date: "date",
  type: "type",
  description: "description",
  counterparty: "counterparty",
  category: "category",
  netCents: "net",
  vatCents: "vat",
  grossCents: "gross",
  source: "source",
};
const SORT_DIRECTION_PARAMS: Readonly<Record<SortDirection, SortDirectionParam>> = {
  asc: "asc",
  desc: "desc",
};

/** The page sizes the list offers; {@link DEFAULT_BOOKING_PAGE_SIZE} (100) is the default. */
export const BOOKING_PAGE_SIZES: readonly number[] = [25, 50, 100, 200];

export function sortParam(sort: BookingSort): BookingSortParam {
  return `${SORT_FIELD_PARAMS[sort.field]}-${SORT_DIRECTION_PARAMS[sort.direction]}`;
}

export function parseSortParam(value: unknown): BookingSort | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.lastIndexOf("-");
  if (separator <= 0) return undefined;
  const fieldParam = value.slice(0, separator);
  const directionParam = value.slice(separator + 1);
  const field = BOOKING_SORT_FIELDS.find(
    (candidate) => SORT_FIELD_PARAMS[candidate] === fieldParam,
  );
  const direction =
    directionParam === "asc" || directionParam === "desc" ? directionParam : undefined;
  return field !== undefined && direction !== undefined ? { field, direction } : undefined;
}

function isDefaultSort(sort: BookingSort): boolean {
  return (
    sort.field === DEFAULT_BOOKING_SORT.field && sort.direction === DEFAULT_BOOKING_SORT.direction
  );
}

export function bookingSearchSort(search: BookingSearch): BookingSort {
  return parseSortParam(search.sort) ?? DEFAULT_BOOKING_SORT;
}

/**
 * The direction a column sorts in when it is chosen: dates and amounts
 * descending (newest, largest first), texts ascending (A first).
 */
export function initialSortDirection(field: BookingSortField): SortDirection {
  return field === "date" || field === "netCents" || field === "vatCents" || field === "grossCents"
    ? "desc"
    : "asc";
}

/**
 * The sort order after activating the header of `field`: the sorted column
 * flips its direction, another column starts with its
 * {@link initialSortDirection}.
 */
export function nextBookingSort(current: BookingSort, field: BookingSortField): BookingSort {
  if (current.field === field) {
    return { field, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { field, direction: initialSortDirection(field) };
}

/** The `sort` param of a sort order: `undefined` for the default. */
export function sortSearchParam(sort: BookingSort): BookingSortParam | undefined {
  return isDefaultSort(sort) ? undefined : sortParam(sort);
}

export function bookingSearchPage(search: BookingSearch): number {
  return search.page ?? 1;
}

export function bookingSearchPageSize(search: BookingSearch): number {
  return search.pageSize ?? DEFAULT_BOOKING_PAGE_SIZE;
}

/** The `page` param of a page: `undefined` for page 1. */
export function pageSearchParam(page: number): number | undefined {
  return page > 1 ? page : undefined;
}

/** The `pageSize` param of a page size: `undefined` for the default. */
export function pageSizeSearchParam(pageSize: number): number | undefined {
  return pageSize === DEFAULT_BOOKING_PAGE_SIZE ? undefined : pageSize;
}

function pageParam(value: unknown): number | undefined {
  const page = nonNegativeInteger(value);
  return page !== undefined && page > 1 ? page : undefined;
}

function pageSizeParam(value: unknown): number | undefined {
  const size = nonNegativeInteger(value);
  return size !== undefined && BOOKING_PAGE_SIZES.includes(size) ? size : undefined;
}

function sortingParam(value: unknown): BookingSortParam | undefined {
  const sort = parseSortParam(value);
  return sort ? sortSearchParam(sort) : undefined;
}

/**
 * The rows a page shows, 1-based and inclusive, for the pagination's
 * "51–100 of 120"; `0–0` for an empty result.
 */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { readonly from: number; readonly to: number } {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
}

/**
 * Removes absent and empty values, so defaults never appear in the URL, and
 * fixes the key order (the URL reads the same however a filter was set).
 */
export function cleanBookingSearch(search: BookingSearch): BookingSearch {
  const result: { -readonly [K in BookingSearchKey]?: BookingSearch[K] } = {};
  if (search.q !== undefined && trimText(search.q) !== "") result.q = search.q;
  if (search.from !== undefined && search.from !== "") result.from = search.from;
  if (search.to !== undefined && search.to !== "") result.to = search.to;
  if (search.type !== undefined) result.type = search.type;
  if (search.category !== undefined && search.category.length > 0) {
    result.category = search.category;
  }
  if (search.source !== undefined) result.source = search.source;
  if (search.vat !== undefined) {
    const vat = sortedVatRateParams(search.vat);
    if (vat !== undefined) result.vat = vat;
  }
  if (search.amountFrom !== undefined) result.amountFrom = search.amountFrom;
  if (search.amountTo !== undefined) result.amountTo = search.amountTo;
  if (search.sort !== undefined) result.sort = search.sort;
  if (search.page !== undefined && search.page > 1) result.page = search.page;
  if (search.pageSize !== undefined && search.pageSize !== DEFAULT_BOOKING_PAGE_SIZE) {
    result.pageSize = search.pageSize;
  }
  return result;
}

/** Every param of the schema, absent. */
const NO_SEARCH: Readonly<Record<BookingSearchKey, undefined>> = {
  q: undefined,
  from: undefined,
  to: undefined,
  type: undefined,
  category: undefined,
  source: undefined,
  vat: undefined,
  amountFrom: undefined,
  amountTo: undefined,
  sort: undefined,
  page: undefined,
  pageSize: undefined,
};

/**
 * `validateSearch` of `/bookings`: reads the raw (router-parsed) params into
 * a {@link BookingSearch}. Never throws; unreadable values are dropped (see
 * the module comment).
 *
 * Every param of the schema is present in the result, dropped ones as
 * `undefined`: TanStack Router merges a route's validated search over the
 * parent's, and the root route keeps the raw params – a dropped key would
 * otherwise show through with its raw value (`type=foo`). Unknown params do
 * show through but are ignored; the next filter change writes a clean URL
 * (`updateBookingSearch`).
 */
export function validateBookingSearch(raw: Readonly<Record<string, unknown>>): BookingSearch {
  return { ...NO_SEARCH, ...validParams(raw) };
}

function validParams(raw: Readonly<Record<string, unknown>>): BookingSearch {
  return cleanBookingSearch({
    q: searchText(raw.q),
    from: isoDate(raw.from),
    to: isoDate(raw.to),
    type: isTypeParam(raw.type) ? raw.type : undefined,
    category: categoryIds(raw.category),
    source: isSourceParam(raw.source) ? raw.source : undefined,
    vat: vatRateParams(raw.vat),
    amountFrom: amountCents(raw.amountFrom),
    amountTo: amountCents(raw.amountTo),
    sort: sortingParam(raw.sort),
    page: pageParam(raw.page),
    pageSize: pageSizeParam(raw.pageSize),
  });
}

/**
 * `search` with `patch` applied (`undefined` removes a param), cleaned.
 *
 * Changing anything but the page – a filter, the sort order or the page
 * size – goes back to page 1 (the old page number would show unrelated
 * rows), unless the patch sets `page` itself.
 */
export function updateBookingSearch(
  search: BookingSearch,
  patch: { readonly [K in BookingSearchKey]?: BookingSearch[K] | undefined },
): BookingSearch {
  const next = cleanBookingSearch({ ...search, ...patch });
  if (Object.hasOwn(patch, "page") || next.page === undefined) return next;
  const withoutPage = (value: BookingSearch) =>
    JSON.stringify(cleanBookingSearch({ ...value, page: undefined }));
  return withoutPage(next) === withoutPage(search) ? next : { ...next, page: undefined };
}

/**
 * The filters of the search params as `BookingQuery` (without sort order and
 * page). The CSV export (#24) adds {@link bookingSearchSort} and
 * `pageSize: "all"`.
 */
export function bookingSearchToQuery(search: BookingSearch): BookingQuery {
  const query: { -readonly [K in keyof BookingQuery]?: BookingQuery[K] } = {};
  if (search.q !== undefined) query.text = search.q;
  if (search.from !== undefined) query.dateFrom = search.from;
  if (search.to !== undefined) query.dateTo = search.to;
  if (search.type !== undefined) query.type = TYPE_PARAMS[search.type];
  if (search.category !== undefined) query.categoryIds = search.category;
  if (search.source !== undefined) query.source = SOURCE_PARAMS[search.source];
  if (search.vat !== undefined) query.vatRates = search.vat.map(vatRateOfParam);
  if (search.amountFrom !== undefined) query.amountFrom = search.amountFrom;
  if (search.amountTo !== undefined) query.amountTo = search.amountTo;
  return query;
}

export function bookingSearchToListQuery(search: BookingSearch): BookingQuery {
  return {
    ...bookingSearchToQuery(search),
    sort: bookingSearchSort(search),
    page: bookingSearchPage(search),
    pageSize: bookingSearchPageSize(search),
  };
}

/**
 * Number of active filters, counting a range (period, amount) once: search
 * text, period, type, categories, source, VAT rates, amount.
 */
export function countActiveFilters(search: BookingSearch): number {
  const active = [
    search.q !== undefined,
    search.from !== undefined || search.to !== undefined,
    search.type !== undefined,
    search.category !== undefined,
    search.source !== undefined,
    search.vat !== undefined,
    search.amountFrom !== undefined || search.amountTo !== undefined,
  ];
  return active.filter(Boolean).length;
}

/**
 * The search params without any filter ("Reset filters"): sort order
 * and page size stay, the page goes back to 1.
 */
export function resetBookingFilters(search: BookingSearch): BookingSearch {
  return cleanBookingSearch({ sort: search.sort, pageSize: search.pageSize });
}

/** The search text as committed to the URL: trimmed; blank removes the param. */
export function searchTextParam(text: string): string | undefined {
  const trimmed = trimText(text);
  return trimmed === "" ? undefined : trimmed;
}

// ---------------------------------------------------------------------------
// Amount inputs

export type AmountFilterResult =
  | { readonly ok: true; readonly cents: number | undefined }
  | { readonly ok: false; readonly error: Exclude<ParseAmountError, "empty"> };

/** An amount filter input: blank = no filter, otherwise a de-DE amount (`parseAmount`). */
export function parseAmountFilter(text: string): AmountFilterResult {
  if (text.trim() === "") return { ok: true, cents: undefined };
  const parsed = parseAmount(text);
  if (parsed.ok) return parsed;
  // "empty" cannot happen after the blank check; treat it as invalid for the type.
  return { ok: false, error: parsed.error === "empty" ? "invalid" : parsed.error };
}

// ---------------------------------------------------------------------------
// Period quick picks

export type Quarter = 1 | 2 | 3 | 4;
export const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];
export const MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export type Period =
  | { readonly kind: "all" }
  | { readonly kind: "year"; readonly year: number }
  | { readonly kind: "quarter"; readonly year: number; readonly quarter: Quarter }
  | { readonly kind: "month"; readonly year: number; readonly month: number }
  | { readonly kind: "custom"; readonly from?: string; readonly to?: string };

export type PeriodKind = Period["kind"];
export const PERIOD_KINDS: readonly PeriodKind[] = ["all", "year", "quarter", "month", "custom"];

export interface DateRange {
  readonly from?: string;
  readonly to?: string;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function isoOf(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one (UTC: no DST shifts).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quarterOfMonth(month: number): Quarter {
  return Math.ceil(month / 3) as Quarter;
}

/** First and last day of the period; `{}` for "all". */
export function periodRange(period: Period): DateRange {
  switch (period.kind) {
    case "all":
      return {};
    case "year":
      return { from: isoOf(period.year, 1, 1), to: isoOf(period.year, 12, 31) };
    case "quarter": {
      const first = period.quarter * 3 - 2;
      const last = period.quarter * 3;
      return {
        from: isoOf(period.year, first, 1),
        to: isoOf(period.year, last, daysInMonth(period.year, last)),
      };
    }
    case "month":
      return {
        from: isoOf(period.year, period.month, 1),
        to: isoOf(period.year, period.month, daysInMonth(period.year, period.month)),
      };
    case "custom":
      return {
        ...(period.from === undefined ? {} : { from: period.from }),
        ...(period.to === undefined ? {} : { to: period.to }),
      };
  }
}

/**
 * The quick pick that `from`/`to` describe exactly (a whole year, quarter or
 * month); any other range – including only one bound – is "custom".
 */
export function detectPeriod(from: string | undefined, to: string | undefined): Period {
  if (from === undefined && to === undefined) return { kind: "all" };
  const start = from === undefined ? undefined : parseIsoDate(from);
  const end = to === undefined ? undefined : parseIsoDate(to);
  if (start && end && start.year === end.year && start.day === 1) {
    const { year } = start;
    const endsMonth = end.day === daysInMonth(year, end.month);
    if (start.month === 1 && end.month === 12 && endsMonth) return { kind: "year", year };
    if (endsMonth && start.month === end.month) {
      return { kind: "month", year, month: start.month };
    }
    if (endsMonth && start.month % 3 === 1 && end.month === start.month + 2) {
      return { kind: "quarter", year, quarter: quarterOfMonth(start.month) };
    }
  }
  return {
    kind: "custom",
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

/** The year a period is about, if any (custom: the year of its start, else of its end). */
export function periodYear(period: Period): number | undefined {
  switch (period.kind) {
    case "all":
      return undefined;
    case "year":
    case "quarter":
    case "month":
      return period.year;
    case "custom": {
      const date = period.from ?? period.to;
      return date === undefined ? undefined : parseIsoDate(date)?.year;
    }
  }
}

/** Today as year and month (1–12), for the quick picks' starting values. */
export interface YearMonth {
  readonly year: number;
  readonly month: number;
}

/**
 * The period after choosing `kind` in the period select, starting from
 * `current`: keeps its year (else the current year) and, for quarter/month,
 * the narrower part it already has (the month's quarter, the quarter's first
 * month, a custom range's starting month) – otherwise today's quarter/month in the current year and the first
 * one in other years. "custom" starts with the current range, so the dates
 * can be adjusted.
 */
/** The month a period starts in, if it has one (custom: of its start, else of its end). */
function periodMonth(period: Period): number | undefined {
  switch (period.kind) {
    case "all":
    case "year":
      return undefined;
    case "quarter":
      return period.quarter * 3 - 2;
    case "month":
      return period.month;
    case "custom": {
      const date = period.from ?? period.to;
      return date === undefined ? undefined : parseIsoDate(date)?.month;
    }
  }
}

export function switchPeriodKind(current: Period, kind: PeriodKind, today: YearMonth): Period {
  const year = periodYear(current) ?? today.year;
  const month = periodMonth(current) ?? (year === today.year ? today.month : 1);
  switch (kind) {
    case "all":
      return { kind: "all" };
    case "year":
      return { kind: "year", year };
    case "quarter":
      return {
        kind: "quarter",
        year,
        quarter: current.kind === "quarter" ? current.quarter : quarterOfMonth(month),
      };
    case "month":
      return { kind: "month", year, month };
    case "custom":
      return { kind: "custom", ...periodRange(current) };
  }
}

/**
 * Years the year select offers, newest first: the given years (tax years and
 * years with bookings), the current one and the one of the active period, so
 * the selection is always listed.
 */
export function periodYearOptions(
  years: readonly number[],
  currentYear: number,
  selectedYear?: number,
): number[] {
  const all = new Set([...years, currentYear]);
  if (selectedYear !== undefined) all.add(selectedYear);
  const sorted = [...all];
  sorted.sort((a, b) => b - a);
  return sorted;
}

// ---------------------------------------------------------------------------
// Categories

export interface CategoryGroup {
  readonly type: BookingType;
  readonly categories: readonly CategoryWithUsage[];
}

function sortedByName(categories: CategoryWithUsage[]): CategoryWithUsage[] {
  categories.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return categories;
}

const TYPE_ORDER: readonly BookingType[] = ["income", "expense"];

/**
 * The category filter's options, grouped by type (income first), sorted by
 * name (de), archived ones included (bookings may still use them). With a
 * type filter only that type's categories – plus the `selected` ones of the
 * other type (e.g. from a URL), so they can be deselected. Selected ids
 * without a category: {@link unknownCategoryIds}.
 */
export function categoryFilterGroups(
  categories: readonly CategoryWithUsage[],
  type: BookingType | undefined,
  selected: readonly number[] = [],
): CategoryGroup[] {
  return TYPE_ORDER.map((groupType) => ({
    type: groupType,
    categories: sortedByName(
      categories.filter(
        (category) =>
          category.type === groupType &&
          (type === undefined || type === groupType || selected.includes(category.id)),
      ),
    ),
  })).filter((group) => group.categories.length > 0);
}

/**
 * Selected ids without a category (deleted, or a manipulated URL): the
 * filter lists them, so they can be deselected.
 */
export function unknownCategoryIds(
  categories: readonly CategoryWithUsage[],
  selected: readonly number[],
): number[] {
  return selected.filter((id) => !categories.some((category) => category.id === id));
}

/**
 * The selected categories after the type filter changed: those of another
 * type are removed (they could never match). Unknown ids (e.g. a deleted
 * category in an old URL) are kept – they simply match nothing. `undefined`
 * when nothing remains.
 */
export function categoriesAfterTypeChange(
  selected: readonly number[] | undefined,
  categories: readonly CategoryWithUsage[],
  type: BookingType | undefined,
): number[] | undefined {
  if (selected === undefined || type === undefined) return selected?.slice();
  const remaining = selected.filter((id) => {
    const category = categories.find((candidate) => candidate.id === id);
    return category === undefined || category.type === type;
  });
  return remaining.length > 0 ? remaining : undefined;
}
