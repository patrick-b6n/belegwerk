import { createFileRoute, Link } from "@tanstack/react-router";
import { CloudDownload, Download, Loader2, MoreHorizontal, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { type BookingQuery, type BookingSort, normalizeBookingQuery } from "@/business/bookings";
import { m } from "@/paraglide/messages.js";
import { Button, buttonVariants } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import {
  BookingFilterBar,
  type BookingSearchPatch,
  type SearchChangeOptions,
} from "@/ui/bookings/booking-filter-bar";
import {
  type BookingSearch,
  bookingSearchSort,
  bookingSearchToListQuery,
  bookingSearchToQuery,
  cleanBookingSearch,
  countActiveFilters,
  pageSearchParam,
  pageSizeSearchParam,
  resetBookingFilters,
  sortSearchParam,
  updateBookingSearch,
  validateBookingSearch,
} from "@/ui/bookings/booking-filter-model";
import {
  type BookingExportAction,
  useBookingExportAction,
} from "@/ui/bookings/booking-export-button";
import { BookingPagination } from "@/ui/bookings/booking-pagination";
import { useBookingList } from "@/ui/bookings/booking-queries";
import { BookingSumsSummary, BookingTable } from "@/ui/bookings/booking-table";
import { useCategoryList } from "@/ui/categories/category-queries";
import { Page, PagePlaceholder } from "@/ui/layout/page";
import { StripeImportDialog } from "@/ui/stripe/stripe-import-dialog";
import { useTaxYearList } from "@/ui/tax-years/tax-year-queries";

/**
 * The booking list (#17) with search and filters (#22), sorting, pages and
 * sums (#23). Filters, sort order, page and page size are validated search
 * params of this route (`validateBookingSearch`, schema in
 * `booking-filter-model.ts`) and go into the list query
 * (`BookingService.list(query)`, #21): sorting and paging happen in SQL.
 * The toolbar: search and filters on the left (they wrap early), on the
 * right "+" (new booking) and a "…" menu with "Export CSV" (#24, all
 * bookings of the filters in that order) and "Stripe importieren" (#31,
 * opens the import dialog); the actions stay on the toolbar's first row.
 */
export const Route = createFileRoute("/bookings/")({
  validateSearch: validateBookingSearch,
  component: BookingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.bookings_title() }) }] }),
});

function BookingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const searchInputId = useId();
  // Mounting the filter bar anew on reset drops pending typed values and
  // the "Custom" period mode.
  const [resetCount, setResetCount] = useState(0);

  const filterQuery = useMemo(() => bookingSearchToQuery(search), [search]);
  const listQuery = useMemo(() => bookingSearchToListQuery(search), [search]);
  // CSV export (#24): the same filters and sort order, every page.
  const exportQuery = useMemo(
    () => ({ ...bookingSearchToQuery(search), sort: bookingSearchSort(search) }),
    [search],
  );
  // Sort order and page come from validated params; only filters can be invalid.
  const normalized = normalizeBookingQuery(filterQuery);
  const errors = normalized.ok ? [] : normalized.errors;
  const filtered = countActiveFilters(search) > 0;
  // Same query (and cache entry) as the list below; for the export button's total.
  const list = useBookingList(listQuery, { enabled: normalized.ok });
  const csvExport = useBookingExportAction({
    query: exportQuery,
    // Not from the previous search's placeholder: its total may differ.
    total: list.data?.ok && !list.isPlaceholderData ? list.data.total : undefined,
    invalid: !normalized.ok,
  });
  const [stripeImportOpen, setStripeImportOpen] = useState(false);

  // Patches apply to the current search (`prev`), not to the one of the last
  // render: two changes in a row (e.g. a debounced commit right after a
  // select) must not undo each other. An unchanged search keeps the URL; the
  // router then adds no history entry. A change of filters, sort order or
  // page size goes back to page 1 (`updateBookingSearch`).
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
    // The reset button is gone now: continue in the search field.
    requestAnimationFrame(() => document.getElementById(searchInputId)?.focus());
  }, [navigate, searchInputId]);

  const categories = useCategoryList();
  const taxYears = useTaxYearList();
  const years = useMemo(() => taxYears.data?.map((taxYear) => taxYear.year) ?? [], [taxYears.data]);

  return (
    <Page title={m.bookings_title()} fill compact>
      {/* One toolbar: the filters (wrapping in their own area), the actions on the right. */}
      <div className="flex shrink-0 items-start gap-4">
        <div className="min-w-0 flex-1">
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
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/bookings/new"
            aria-label={m.bookings_new()}
            title={m.bookings_new()}
            className={buttonVariants({ size: "icon" })}
          >
            <Plus aria-hidden />
          </Link>
          <MoreActionsMenu csvExport={csvExport} onStripeImport={() => setStripeImportOpen(true)} />
          <StripeImportDialog open={stripeImportOpen} onOpenChange={setStripeImportOpen} />
        </div>
      </div>
      <BookingList
        query={listQuery}
        sort={bookingSearchSort(search)}
        invalid={!normalized.ok}
        filtered={filtered}
        onSearchChange={changeSearch}
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
  sort,
  invalid,
  filtered,
  onSearchChange,
  onReset,
}: Readonly<{
  query: BookingQuery;
  sort: BookingSort;
  invalid: boolean;
  filtered: boolean;
  onSearchChange: (patch: BookingSearchPatch, options?: SearchChangeOptions) => void;
  onReset: () => void;
}>) {
  const paginationId = useId();
  // An invalid query is not run (the filter bar shows the errors).
  const { data, error, isPending, isPlaceholderData, isFetching, refetch } = useBookingList(query, {
    enabled: !invalid,
  });

  // A page after the last (old link, last booking of the page deleted) shows
  // the last page (#21); the URL follows, replacing its entry so "back" does
  // not return to the empty page. Only for a fresh result of this query: not
  // a placeholder of the previous one, and not a cached one being refetched
  // (it may be clamped by data that changed since). The next result has the
  // requested page, so this runs once.
  const requestedPage = query.page ?? 1;
  const shownPage = data?.ok && !isPlaceholderData && !isFetching ? data.page : undefined;
  useEffect(() => {
    if (shownPage !== undefined && shownPage !== requestedPage) {
      onSearchChange({ page: pageSearchParam(shownPage) }, { replace: true });
    }
  }, [shownPage, requestedPage, onSearchChange]);

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
      className="flex min-h-0 flex-1 flex-col transition-opacity aria-busy:opacity-60"
      aria-busy={isPlaceholderData || undefined}
    >
      {/* The pagination shows the total; the count is announced on every change. */}
      <p role="status" className="sr-only">
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
        // The table scrolls in its own box (sticky header); sums and pagination stay below.
        // At least min-h-48: in a low window the panel scrolls instead of squeezing the table.
        <div className="flex min-h-48 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
          <div className="min-h-0 flex-1 overflow-auto">
            <BookingTable
              bookings={data.items}
              sort={sort}
              onSortChange={(next) => onSearchChange({ sort: sortSearchParam(next) })}
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1.5 border-t py-1.5 pr-2 pl-4">
            <BookingSumsSummary sums={data.sums} filtered={filtered} />
            <BookingPagination
              id={paginationId}
              page={data.page}
              pageCount={data.pageCount}
              pageSize={data.pageSize === "all" ? data.total : data.pageSize}
              total={data.total}
              onPageChange={(page) => onSearchChange({ page: pageSearchParam(page) })}
              onPageSizeChange={(size) => onSearchChange({ pageSize: pageSizeSearchParam(size) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "…" (more actions) next to "+": CSV export and Stripe import. A disabled
 * export says why in its tooltip; while it runs it shows a spinner.
 */
function MoreActionsMenu({
  csvExport,
  onStripeImport,
}: Readonly<{ csvExport: BookingExportAction; onStripeImport: () => void }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label={m.bookings_more_actions()}
            title={m.bookings_more_actions()}
          />
        }
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          disabled={csvExport.disabled}
          title={csvExport.hint}
          onClick={() => void csvExport.run()}
        >
          {csvExport.running ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <Download aria-hidden />
          )}
          {csvExport.running ? m.bookings_export_running() : m.bookings_export()}
        </DropdownMenuItem>
        <DropdownMenuItem title={m.stripe_import_button_hint()} onClick={onStripeImport}>
          <CloudDownload aria-hidden />
          {m.stripe_import_button()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
