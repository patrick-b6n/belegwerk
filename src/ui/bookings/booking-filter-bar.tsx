import { RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BookingQueryError, BookingQueryField } from "@/business/bookings";
import type { CategoryWithUsage } from "@/business/categories";
import { formatDate } from "@/business/format";
import type { BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { FormField } from "@/ui/forms/form-field";
import { useDebouncedInput } from "@/ui/hooks/use-debounced-input";

import {
  type BookingSearch,
  type BookingSearchKey,
  type BookingSourceParam,
  type BookingTypeParam,
  categoriesAfterTypeChange,
  sortedVatRateParams,
  VAT_RATE_PARAMS,
  type VatRateParam,
  categoryFilterGroups,
  unknownCategoryIds,
  countActiveFilters,
  type DateRange,
  detectPeriod,
  MONTHS,
  parseAmountFilter,
  type Period,
  PERIOD_KINDS,
  type PeriodKind,
  periodRange,
  periodYearOptions,
  QUARTERS,
  type Quarter,
  searchTextParam,
  switchPeriodKind,
  type YearMonth,
} from "./booking-filter-model";
import { formatAmountInput } from "./booking-form-model";
import {
  amountFilterErrorMessage,
  bookingQueryErrorMessage,
  VAT_RATE_LABELS,
} from "./booking-messages";

/** A change of search params; `undefined` removes a param. */
export type BookingSearchPatch = {
  readonly [K in BookingSearchKey]?: BookingSearch[K] | undefined;
};

export interface SearchChangeOptions {
  /**
   * Replace the current history entry instead of adding one: while a typed
   * value is being edited, so back/forward steps over whole filter changes,
   * not over keystrokes.
   */
  readonly replace?: boolean;
}

export interface BookingFilterBarProps {
  readonly search: BookingSearch;
  /** Errors of `normalizeBookingQuery` for the current search params. */
  readonly errors: readonly BookingQueryError[];
  readonly categories: readonly CategoryWithUsage[];
  /** Years the year quick pick offers (tax years and years with bookings). */
  readonly years: readonly number[];
  /** Id of the search input (focused after "Filter zurücksetzen"). */
  readonly searchInputId: string;
  readonly onSearchChange: (patch: BookingSearchPatch, options?: SearchChangeOptions) => void;
  readonly onReset: () => void;
}

/** Delay of the search text; amounts and dates wait a little longer (several keystrokes). */
const TEXT_DELAY = 300;
const VALUE_DELAY = 500;

const TYPE_FILTERS: readonly BookingTypeParam[] = ["einnahmen", "ausgaben"];
const SOURCE_FILTERS: readonly BookingSourceParam[] = ["manuell", "stripe"];
const TYPE_OF_PARAM: Readonly<Record<BookingTypeParam, BookingType>> = {
  einnahmen: "income",
  ausgaben: "expense",
};
const ALL = "all";

const TYPE_FILTER_LABELS: Readonly<Record<BookingTypeParam, () => string>> = {
  einnahmen: m.bookings_filter_type_income,
  ausgaben: m.bookings_filter_type_expense,
};
const SOURCE_FILTER_LABELS: Readonly<Record<BookingSourceParam, () => string>> = {
  manuell: m.bookings_source_manual,
  stripe: m.bookings_source_stripe,
};
const PERIOD_KIND_LABELS: Readonly<Record<PeriodKind, () => string>> = {
  all: m.bookings_filter_period_all,
  year: m.bookings_filter_period_year,
  quarter: m.bookings_filter_period_quarter,
  month: m.bookings_filter_period_month,
  custom: m.bookings_filter_period_custom,
};
const CATEGORY_GROUP_LABELS: Readonly<Record<BookingType, () => string>> = {
  income: m.bookings_filter_category_group_income,
  expense: m.bookings_filter_category_group_expense,
};

const VAT_RATE_FILTER_LABELS: Readonly<Record<VatRateParam, () => string>> = {
  ohne: m.bookings_filter_vat_rate_none,
  "0": VAT_RATE_LABELS["0"],
  "7": VAT_RATE_LABELS["7"],
  "19": VAT_RATE_LABELS["19"],
  rc: VAT_RATE_LABELS.reverse_charge,
};

const monthFormat = new Intl.DateTimeFormat("de-DE", { month: "long", timeZone: "UTC" });
const monthName = (month: number) => monthFormat.format(new Date(Date.UTC(2000, month - 1, 1)));

/**
 * Whether committing a typed value should replace the history entry: only
 * when an existing value is edited. Setting or clearing a value adds an
 * entry, so "back" returns to the list without (or with the old) filter.
 */
function replaceWhenEditing(before: unknown, after: unknown): SearchChangeOptions {
  return { replace: before !== undefined && after !== undefined };
}

/**
 * The search field and filter bar above the booking list (#22). Shows the
 * search params of `/buchungen` and reports changes as patches; the route
 * writes them to the URL. Typed values (search text, amounts, custom dates)
 * are committed debounced, choices right away.
 *
 * Errors of the business layer's query validation (inverted ranges, too
 * long text from a URL) appear at the affected control.
 */
export function BookingFilterBar({
  search,
  errors,
  categories,
  years,
  searchInputId,
  onSearchChange,
  onReset,
}: BookingFilterBarProps) {
  const id = (name: string) => `${searchInputId}-${name}`;
  const errorsOf = (field: BookingQueryField) =>
    errors.filter((error) => error.field === field).map(bookingQueryErrorMessage);
  const activeCount = countActiveFilters(search);
  const type = search.art === undefined ? undefined : TYPE_OF_PARAM[search.art];

  return (
    <div
      role="search"
      aria-label={m.bookings_filter_label()}
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-end gap-4">
        <SearchField
          id={searchInputId}
          value={search.q}
          errors={errorsOf("text")}
          onCommit={(q) => onSearchChange({ q }, replaceWhenEditing(search.q, q))}
        />
        <div className="ml-auto flex items-center gap-3">
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {activeCount === 0
              ? ""
              : activeCount === 1
                ? m.bookings_filter_active_one()
                : m.bookings_filter_active_other({ count: String(activeCount) })}
          </span>
          <Button variant="outline" disabled={activeCount === 0} onClick={onReset}>
            <RotateCcw aria-hidden />
            {m.bookings_filter_reset()}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <PeriodFilter
          idPrefix={id("period")}
          from={search.von}
          to={search.bis}
          years={years}
          fromErrors={errorsOf("dateFrom")}
          toErrors={errorsOf("dateTo")}
          onChange={(range, options) => onSearchChange({ von: range.from, bis: range.to }, options)}
        />

        <FormField
          id={id("type")}
          label={m.bookings_filter_type_label()}
          errors={errorsOf("type")}
          className="w-32"
        >
          {(control) => (
            <Select<string>
              items={[
                { value: ALL, label: m.bookings_filter_type_all() },
                ...TYPE_FILTERS.map((value) => ({ value, label: TYPE_FILTER_LABELS[value]() })),
              ]}
              value={search.art ?? ALL}
              onValueChange={(value) => {
                const art =
                  value === ALL || value === null ? undefined : (value as BookingTypeParam);
                const nextType = art === undefined ? undefined : TYPE_OF_PARAM[art];
                onSearchChange({
                  art,
                  kategorie: categoriesAfterTypeChange(search.kategorie, categories, nextType),
                });
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{m.bookings_filter_type_all()}</SelectItem>
                {TYPE_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {TYPE_FILTER_LABELS[value]()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        <CategoryFilter
          id={id("category")}
          selected={search.kategorie ?? []}
          categories={categories}
          type={type}
          errors={errorsOf("categoryIds")}
          onChange={(kategorie) => onSearchChange({ kategorie })}
        />

        <FormField
          id={id("source")}
          label={m.bookings_filter_source_label()}
          errors={errorsOf("source")}
          className="w-32"
        >
          {(control) => (
            <Select<string>
              items={[
                { value: ALL, label: m.bookings_filter_source_all() },
                ...SOURCE_FILTERS.map((value) => ({ value, label: SOURCE_FILTER_LABELS[value]() })),
              ]}
              value={search.quelle ?? ALL}
              onValueChange={(value) =>
                onSearchChange({
                  quelle:
                    value === ALL || value === null ? undefined : (value as BookingSourceParam),
                })
              }
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{m.bookings_filter_source_all()}</SelectItem>
                {SOURCE_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {SOURCE_FILTER_LABELS[value]()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>

        <VatRateFilter
          id={id("vat-rate")}
          selected={search.ust ?? []}
          errors={errorsOf("vatRates")}
          onChange={(ust) => onSearchChange({ ust })}
        />

        <div
          role="group"
          aria-label={m.bookings_filter_amount_label()}
          className="flex items-start gap-2"
        >
          <AmountField
            id={id("amount-from")}
            label={m.bookings_filter_amount_from_label()}
            placeholder={m.bookings_filter_amount_from_placeholder()}
            cents={search.betragVon}
            errors={errorsOf("amountFrom")}
            onCommit={(betragVon) =>
              onSearchChange({ betragVon }, replaceWhenEditing(search.betragVon, betragVon))
            }
          />
          <AmountField
            id={id("amount-to")}
            label={m.bookings_filter_amount_to_label()}
            placeholder={m.bookings_filter_amount_to_placeholder()}
            cents={search.betragBis}
            errors={errorsOf("amountTo")}
            onCommit={(betragBis) =>
              onSearchChange({ betragBis }, replaceWhenEditing(search.betragBis, betragBis))
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Search text, debounced; Enter commits right away. */
function SearchField({
  id,
  value,
  errors,
  onCommit,
}: Readonly<{
  id: string;
  value: string | undefined;
  errors: readonly string[];
  onCommit: (q: string | undefined) => void;
}>) {
  const input = useDebouncedInput({
    source: value ?? "",
    matches: (text, source) => searchTextParam(text) === searchTextParam(source),
    onCommit: (text) => onCommit(searchTextParam(text)),
    delay: TEXT_DELAY,
  });
  return (
    <FormField
      id={id}
      label={m.bookings_filter_search_label()}
      errors={errors}
      className="w-full max-w-md"
    >
      {(control) => (
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            {...control}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={m.bookings_filter_search_placeholder()}
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") input.flush();
            }}
            onBlur={input.flush}
            className="pl-8"
          />
        </div>
      )}
    </FormField>
  );
}

/** Identity of a period range as the URL has it (blank = absent). */
function rangeKey(from: string | undefined, to: string | undefined): string {
  return `${from ?? ""}/${to ?? ""}`;
}

/**
 * Period: quick picks year / quarter / month of a year, or custom dates. Only
 * `von`/`bis` are stored; the quick pick is derived from them. "Frei" stays
 * selected while it is used (also with empty dates or dates that happen to
 * form a whole month), until another quick pick is chosen, the filters are
 * reset (the filter bar is then mounted anew) or the range changes from
 * outside (back/forward, a link).
 */
function PeriodFilter({
  idPrefix,
  from,
  to,
  years,
  fromErrors,
  toErrors,
  onChange,
}: Readonly<{
  idPrefix: string;
  from: string | undefined;
  to: string | undefined;
  years: readonly number[];
  fromErrors: readonly string[];
  toErrors: readonly string[];
  onChange: (range: DateRange, options?: SearchChangeOptions) => void;
}>) {
  const [customMode, setCustomMode] = useState(false);
  // The range this filter committed last, until the URL reflects it.
  const ownRange = useRef<string | undefined>(undefined);
  const commit = (range: DateRange, options?: SearchChangeOptions) => {
    ownRange.current = rangeKey(range.from, range.to);
    onChange(range, options);
  };
  useEffect(() => {
    const own = ownRange.current === rangeKey(from, to);
    ownRange.current = undefined;
    if (!own) setCustomMode(false);
  }, [from, to]);
  const [today] = useState<YearMonth>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const detected = detectPeriod(from, to);
  const kind: PeriodKind = customMode ? "custom" : detected.kind;
  const period: Period = customMode ? { kind: "custom", from, to } : detected;
  const setPeriod = (next: Period) => commit(periodRange(next));

  const yearOptions = periodYearOptions(
    years,
    today.year,
    period.kind === "year" || period.kind === "quarter" || period.kind === "month"
      ? period.year
      : undefined,
  );
  const range = periodRange(period);
  const rangeText =
    kind !== "all" && kind !== "custom" && range.from && range.to
      ? m.bookings_filter_range({ from: formatDate(range.from), to: formatDate(range.to) })
      : undefined;

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      <FormField
        id={`${idPrefix}-kind`}
        label={m.bookings_filter_period_label()}
        description={rangeText}
        errors={[]}
        className="w-48"
      >
        {(control) => (
          <Select<PeriodKind>
            items={PERIOD_KINDS.map((value) => ({ value, label: PERIOD_KIND_LABELS[value]() }))}
            value={kind}
            onValueChange={(value) => {
              if (value === null) return;
              setCustomMode(value === "custom");
              setPeriod(switchPeriodKind(detected, value, today));
            }}
          >
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {PERIOD_KIND_LABELS[value]()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      {(period.kind === "year" || period.kind === "quarter" || period.kind === "month") && (
        <FormField
          id={`${idPrefix}-year`}
          label={m.bookings_filter_year_label()}
          errors={[]}
          className="w-24"
        >
          {(control) => (
            <Select<string>
              items={yearOptions.map((year) => ({ value: String(year), label: String(year) }))}
              value={String(period.year)}
              onValueChange={(value) => {
                if (value !== null) setPeriod({ ...period, year: Number(value) });
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}

      {period.kind === "quarter" && (
        <FormField
          id={`${idPrefix}-quarter`}
          label={m.bookings_filter_quarter_label()}
          errors={[]}
          className="w-36"
        >
          {(control) => (
            <Select<string>
              items={QUARTERS.map((quarter) => ({
                value: String(quarter),
                label: m.bookings_filter_quarter({ quarter: String(quarter) }),
              }))}
              value={String(period.quarter)}
              onValueChange={(value) => {
                if (value !== null) setPeriod({ ...period, quarter: Number(value) as Quarter });
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUARTERS.map((quarter) => (
                  <SelectItem key={quarter} value={String(quarter)}>
                    {m.bookings_filter_quarter({ quarter: String(quarter) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}

      {period.kind === "month" && (
        <FormField
          id={`${idPrefix}-month`}
          label={m.bookings_filter_month_label()}
          errors={[]}
          className="w-36"
        >
          {(control) => (
            <Select<string>
              items={MONTHS.map((month) => ({ value: String(month), label: monthName(month) }))}
              value={String(period.month)}
              onValueChange={(value) => {
                if (value !== null) setPeriod({ ...period, month: Number(value) });
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month} value={String(month)}>
                    {monthName(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}

      {period.kind === "custom" && (
        <>
          <DateField
            id={`${idPrefix}-from`}
            label={m.bookings_filter_date_from_label()}
            value={from}
            errors={fromErrors}
            onCommit={(date) => {
              setCustomMode(true);
              commit({ from: date, to }, replaceWhenEditing(from, date));
            }}
          />
          <DateField
            id={`${idPrefix}-to`}
            label={m.bookings_filter_date_to_label()}
            value={to}
            errors={toErrors}
            onCommit={(date) => {
              setCustomMode(true);
              commit({ from, to: date }, replaceWhenEditing(to, date));
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * A custom period bound (native date input, ISO value). Debounced, because
 * typing a date changes the value per segment; an incomplete date reads as
 * empty and removes the bound.
 */
function DateField({
  id,
  label,
  value,
  errors,
  onCommit,
}: Readonly<{
  id: string;
  label: string;
  value: string | undefined;
  errors: readonly string[];
  onCommit: (date: string | undefined) => void;
}>) {
  const input = useDebouncedInput({
    source: value ?? "",
    onCommit: (text) => onCommit(text === "" ? undefined : text),
    delay: VALUE_DELAY,
  });
  return (
    <FormField id={id} label={label} errors={errors} className="w-40">
      {(control) => (
        <Input
          {...control}
          type="date"
          min="1000-01-01"
          max="9999-12-31"
          value={input.value}
          onChange={(event) => input.onChange(event.target.value)}
          onBlur={input.flush}
          className="w-40"
        />
      )}
    </FormField>
  );
}

/**
 * Amount bound in euros with decimal comma (`parseAmount`), stored in cents.
 * An unreadable amount is shown as error and not committed; on blur a valid
 * one is shown in canonical form ("1.500" → "1.500,00", the dot groups
 * thousands).
 */
function AmountField({
  id,
  label,
  placeholder,
  cents,
  errors,
  onCommit,
}: Readonly<{
  id: string;
  label: string;
  placeholder: string;
  cents: number | undefined;
  errors: readonly string[];
  onCommit: (cents: number | undefined) => void;
}>) {
  // The text whose check failed; its error shows until the text changes.
  const [invalidText, setInvalidText] = useState<string>();
  const input = useDebouncedInput({
    source: cents === undefined ? "" : formatAmountInput(cents),
    matches: (text, source) => {
      const typed = parseAmountFilter(text);
      const current = parseAmountFilter(source);
      return typed.ok && current.ok && typed.cents === current.cents;
    },
    onCommit: (text) => {
      const parsed = parseAmountFilter(text);
      if (parsed.ok) {
        setInvalidText(undefined);
        onCommit(parsed.cents);
      } else {
        setInvalidText(text);
      }
    },
    delay: VALUE_DELAY,
  });
  const parsed = parseAmountFilter(input.value);
  const ownError =
    invalidText !== undefined && invalidText === input.value && !parsed.ok
      ? amountFilterErrorMessage(parsed.error)
      : undefined;

  return (
    <FormField id={id} label={label} errors={ownError ? [ownError] : errors} className="w-32">
      {(control) => (
        <div className="relative">
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            placeholder={placeholder}
            value={input.value}
            onChange={(event) => input.onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") input.flush();
            }}
            onBlur={() => {
              input.flush();
              const value = parseAmountFilter(input.value);
              if (value.ok && value.cents !== undefined) {
                const canonical = formatAmountInput(value.cents);
                if (canonical !== input.value) {
                  input.onChange(canonical);
                  input.flush();
                }
              }
            }}
            className="pr-7 text-right tabular-nums"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground"
          >
            €
          </span>
        </div>
      )}
    </FormField>
  );
}

/** A selected id without a category. */
function unknownLabel(categoryId: number): string {
  return m.bookings_filter_category_unknown_id({ id: String(categoryId) });
}

/** A category as the filter shows it: archived ones marked. */
function categoryLabel(category: CategoryWithUsage): string {
  return category.archived
    ? m.bookings_filter_category_archived({ name: category.name })
    : category.name;
}

/**
 * Multi-select of categories, grouped by type (with a type filter only that
 * type's categories), archived ones marked. Selected categories of the other
 * type and selected ids without a category are listed marked, so they can be
 * deselected.
 */
function CategoryFilter({
  id,
  selected,
  categories,
  type,
  errors,
  onChange,
}: Readonly<{
  id: string;
  selected: readonly number[];
  categories: readonly CategoryWithUsage[];
  type: BookingType | undefined;
  errors: readonly string[];
  onChange: (ids: number[] | undefined) => void;
}>) {
  const groups = categoryFilterGroups(categories, type, selected);
  const unknown = unknownCategoryIds(categories, selected);
  // Selected categories the type filter excludes (e.g. from a URL) are listed
  // marked, so they can be deselected.
  const label = (category: CategoryWithUsage) =>
    type !== undefined && category.type !== type
      ? m.bookings_filter_category_other_type({ name: categoryLabel(category) })
      : categoryLabel(category);
  const items = [
    ...categories.map((category) => ({ value: category.id, label: label(category) })),
    ...unknown.map((categoryId) => ({ value: categoryId, label: unknownLabel(categoryId) })),
  ];
  const summary = (ids: readonly number[]) => {
    if (ids.length === 0) return m.bookings_filter_category_all();
    if (ids.length > 1) return m.bookings_filter_category_count({ count: String(ids.length) });
    const category = categories.find((candidate) => candidate.id === ids[0]);
    return category ? label(category) : unknownLabel(ids[0] ?? 0);
  };

  return (
    <FormField id={id} label={m.bookings_filter_category_label()} errors={errors} className="w-52">
      {(control) => (
        <Select<number, true>
          multiple
          items={items}
          value={selected}
          onValueChange={(ids) => onChange(ids.length > 0 ? ids : undefined)}
        >
          <SelectTrigger {...control}>
            <SelectValue>{(ids: readonly number[]) => summary(ids)}</SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="w-auto min-w-(--anchor-width)"
          >
            {groups.map((group) => (
              <SelectGroup key={group.type}>
                <SelectLabel>{CATEGORY_GROUP_LABELS[group.type]()}</SelectLabel>
                {group.categories.map((category) => (
                  <SelectItem
                    key={category.id}
                    value={category.id}
                    className={
                      category.archived || (type !== undefined && category.type !== type)
                        ? "text-muted-foreground"
                        : undefined
                    }
                  >
                    {label(category)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            {unknown.length > 0 && (
              <SelectGroup>
                <SelectLabel>{m.bookings_filter_category_group_unknown()}</SelectLabel>
                {unknown.map((categoryId) => (
                  <SelectItem key={categoryId} value={categoryId} className="text-muted-foreground">
                    {unknownLabel(categoryId)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}

/** The selected VAT rates as the trigger shows them. */
function vatRateSummary(rates: readonly VatRateParam[]): string {
  if (rates.length === 0) return m.bookings_filter_vat_rate_all();
  return rates.map((rate) => VAT_RATE_FILTER_LABELS[rate]()).join(", ");
}

/**
 * Multi-select of VAT rates (#26): the EÜR's drill-down links filter by the
 * rates of a line (e.g. line 15 = 7 % and 19 %); here they can be seen and
 * changed. "Ohne USt-Satz" = bookings without a rate (small business).
 */
function VatRateFilter({
  id,
  selected,
  errors,
  onChange,
}: Readonly<{
  id: string;
  selected: readonly VatRateParam[];
  errors: readonly string[];
  onChange: (rates: readonly VatRateParam[] | undefined) => void;
}>) {
  return (
    <FormField id={id} label={m.bookings_filter_vat_rate_label()} errors={errors} className="w-44">
      {(control) => (
        <Select<VatRateParam, true>
          multiple
          items={VAT_RATE_PARAMS.map((value) => ({
            value,
            label: VAT_RATE_FILTER_LABELS[value](),
          }))}
          value={[...selected]}
          onValueChange={(rates) => onChange(sortedVatRateParams(rates))}
        >
          <SelectTrigger {...control}>
            <SelectValue>{(rates: readonly VatRateParam[]) => vatRateSummary(rates)}</SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="w-auto min-w-(--anchor-width)"
          >
            {VAT_RATE_PARAMS.map((value) => (
              <SelectItem key={value} value={value}>
                {VAT_RATE_FILTER_LABELS[value]()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
