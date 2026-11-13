import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, RotateCcw } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";

import { type BookingQuery, normalizeBookingQuery } from "@/business/bookings";
import { m } from "@/paraglide/messages.js";
import { Button, buttonVariants } from "@/ui/components/ui/button";
import {
  BookingFilterBar,
  type BookingSearchPatch,
  type SearchChangeOptions,
} from "@/ui/bookings/booking-filter-bar";
import {
  type BookingSearch,
  bookingSearchToQuery,
  cleanBookingSearch,
  countActiveFilters,
  resetBookingFilters,
  updateBookingSearch,
  validateBookingSearch,
} from "@/ui/bookings/booking-filter-model";
import { useBookingList } from "@/ui/bookings/booking-queries";
import { BookingTable } from "@/ui/bookings/booking-table";
import { useCategoryList } from "@/ui/categories/category-queries";
import { Page, PagePlaceholder } from "@/ui/layout/page";
import { useTaxYearList } from "@/ui/tax-years/tax-year-queries";

/**
 * The booking list (#17) with search and filters (#22). The filters are
 * validated search params of this route (`validateBookingSearch`, schema in
 * `booking-filter-model.ts`) and go into the list query
 * (`BookingService.list(query)`, #21). Until pagination and sorting arrive
 * (#23, further params of the same schema), the list shows every matching
 * booking in the default order (newest first).
 */
export const Route = createFileRoute("/buchungen/")({
  validateSearch: validateBookingSearch,
  component: BookingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.bookings_title() }) }] }),
});

function BookingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const searchInputId = useId();
  // Mounting the filter bar anew on reset drops pending typed values and
  // the "Frei" period mode.
  const [resetCount, setResetCount] = useState(0);

  const filterQuery = useMemo(() => bookingSearchToQuery(search), [search]);
  const normalized = normalizeBookingQuery(filterQuery);
  const errors = normalized.ok ? [] : normalized.errors;
  const filtered = countActiveFilters(search) > 0;

  // Patches apply to the current search (`prev`), not to the one of the last
  // render: two changes in a row (e.g. a debounced commit right after a
  // select) must not undo each other. An unchanged search keeps the URL; the
  // router then adds no history entry.
  const changeSearch = useCallback(
    (patch: BookingSearchPatch, options?: SearchChangeOptions) => {
      void navigate({
        search: (prev) => {
          const next = updateBookingSearch(prev, patch);
          return sameSearch(next, prev) ? prev : next;
        },
        replace: options?.replace ?? false,
      });
    },
    [navigate],
  );
  const reset = useCallback(() => {
    void navigate({ search: (prev) => resetBookingFilters(prev) });
    setResetCount((count) => count + 1);
    // The reset button is disabled now: continue in the search field.
    requestAnimationFrame(() => document.getElementById(searchInputId)?.focus());
  }, [navigate, searchInputId]);

  const categories = useCategoryList();
  const taxYears = useTaxYearList();
  const years = useMemo(() => taxYears.data?.map((taxYear) => taxYear.year) ?? [], [taxYears.data]);

  return (
    <Page
      title={m.bookings_title()}
      actions={
        <Link to="/buchungen/neu" className={buttonVariants()}>
          <Plus aria-hidden />
          {m.bookings_new()}
        </Link>
      }
    >
      <BookingFilterBar
        key={resetCount}
        search={search}
        errors={errors}
        categories={categories.data ?? []}
        years={years}
        searchInputId={searchInputId}
        onSearchChange={changeSearch}
        onReset={reset}
      />
      <BookingList
        query={{ ...filterQuery, pageSize: "all" }}
        invalid={!normalized.ok}
        filtered={filtered}
        onReset={reset}
      />
    </Page>
  );
}

/** Whether two searches give the same URL (`undefined` params are not written). */
function sameSearch(a: BookingSearch, b: BookingSearch): boolean {
  return JSON.stringify(cleanBookingSearch(a)) === JSON.stringify(cleanBookingSearch(b));
}

function BookingList({
  query,
  invalid,
  filtered,
  onReset,
}: Readonly<{ query: BookingQuery; invalid: boolean; filtered: boolean; onReset: () => void }>) {
  // An invalid query is not run (the filter bar shows the errors).
  const { data, error, isPending, isPlaceholderData, refetch } = useBookingList(query, {
    enabled: !invalid,
  });

  if (invalid) {
    // The filter bar shows the errors at the controls.
    return <p className="text-muted-foreground">{m.bookings_filter_invalid()}</p>;
  }
  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.bookings_loading()}
      </p>
    );
  }
  // The query was checked above; an invalid result would be a programmer error.
  if (error || !data.ok) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.bookings_load_error()}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  if (data.total === 0 && !filtered && !isPlaceholderData) {
    return <PagePlaceholder>{m.bookings_empty()}</PagePlaceholder>;
  }
  return (
    <div
      className="flex flex-col gap-3 transition-opacity aria-busy:opacity-60"
      aria-busy={isPlaceholderData || undefined}
    >
      <p role="status" className="text-sm text-muted-foreground">
        {data.total === 1
          ? m.bookings_found_one()
          : m.bookings_found_other({ count: String(data.total) })}
      </p>
      {data.total === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <PagePlaceholder>{m.bookings_filter_no_results()}</PagePlaceholder>
          <Button variant="outline" onClick={onReset}>
            <RotateCcw aria-hidden />
            {m.bookings_filter_reset()}
          </Button>
        </div>
      ) : (
        <BookingTable bookings={data.items} />
      )}
    </div>
  );
}
