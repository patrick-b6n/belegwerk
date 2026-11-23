import {
  createColumnHelper,
  metaHelper,
  tableFeatures,
  useTable,
  type Row,
} from "@tanstack/react-table";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpDown, ArrowUpRight } from "lucide-react";
import { type MouseEvent, type ReactNode, useMemo } from "react";

import type {
  BookingListItem,
  BookingSort,
  BookingSortField,
  BookingSums,
  SortDirection,
} from "@/business/bookings";
import { formatCurrency, formatDate } from "@/business/format";
import type { BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import { Badge } from "@/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";

import { nextBookingSort } from "./booking-filter-model";
import { BOOKING_SOURCE_LABELS, BOOKING_TYPE_LABELS } from "./booking-messages";

/**
 * Per column: classes for header and cells (e.g. right-aligned amounts) and
 * the search field the column sorts by (#23); without one the header is
 * plain text.
 */
type BookingColumnMeta = { className?: string; sortField?: BookingSortField };

const features = tableFeatures({ columnMeta: metaHelper<BookingColumnMeta>() });
const column = createColumnHelper<typeof features, BookingListItem>();

const AMOUNT = "text-right tabular-nums";

/**
 * Text colour of the gross amount. Never the only signal: the type column
 * names the type and shows an arrow.
 */
const TYPE_AMOUNT_CLASS: Record<BookingType, string> = {
  income: "text-emerald-700",
  expense: "text-rose-700",
};

/** Column names by sort field: headers, the caption and the sort buttons' tooltips. */
const COLUMN_LABELS: Readonly<Record<BookingSortField, () => string>> = {
  date: m.bookings_column_date,
  type: m.bookings_column_type,
  description: m.bookings_column_description,
  counterparty: m.bookings_column_counterparty,
  category: m.bookings_column_category,
  netCents: m.bookings_column_net,
  vatCents: m.bookings_column_vat,
  grossCents: m.bookings_column_gross,
  source: m.bookings_column_source,
};

const DIRECTION_LABELS: Readonly<Record<SortDirection, () => string>> = {
  asc: m.bookings_sort_ascending,
  desc: m.bookings_sort_descending,
};

const columns = column.columns([
  column.accessor("date", {
    header: () => COLUMN_LABELS.date(),
    cell: ({ getValue }) => <time dateTime={getValue()}>{formatDate(getValue())}</time>,
    meta: { className: "tabular-nums", sortField: "date" },
  }),
  column.accessor("type", {
    header: () => COLUMN_LABELS.type(),
    cell: ({ getValue }) => <BookingTypeBadge type={getValue()} />,
    meta: { sortField: "type" },
  }),
  column.accessor("description", {
    header: () => COLUMN_LABELS.description(),
    // The description is the row's link: focusable, opens the booking with Enter.
    cell: ({ row }) => (
      <Link
        to="/bookings/$bookingId"
        params={{ bookingId: row.original.id }}
        title={row.original.description}
        className="block truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.original.description}
      </Link>
    ),
    meta: { className: "w-full max-w-0 min-w-60", sortField: "description" },
  }),
  column.accessor("counterparty", {
    header: () => COLUMN_LABELS.counterparty(),
    cell: ({ getValue }) => (
      <span title={getValue()} className="block max-w-40 truncate">
        {getValue()}
      </span>
    ),
    meta: { sortField: "counterparty" },
  }),
  column.accessor((booking) => booking.category.name, {
    id: "category",
    header: () => COLUMN_LABELS.category(),
    cell: ({ row }) => (
      <span title={row.original.category.name} className="flex max-w-40 items-center gap-1.5">
        <span className="truncate">{row.original.category.name}</span>
        {row.original.category.archived && <Badge>{m.bookings_category_archived()}</Badge>}
      </span>
    ),
    meta: { sortField: "category" },
  }),
  column.accessor("netCents", {
    header: () => COLUMN_LABELS.netCents(),
    cell: ({ getValue }) => formatCurrency(getValue()),
    meta: { className: AMOUNT, sortField: "netCents" },
  }),
  column.accessor("vatCents", {
    header: () => COLUMN_LABELS.vatCents(),
    cell: ({ getValue }) => formatCurrency(getValue()),
    meta: { className: AMOUNT, sortField: "vatCents" },
  }),
  column.accessor("grossCents", {
    header: () => COLUMN_LABELS.grossCents(),
    cell: ({ row }) => (
      <span className={cn("font-semibold", TYPE_AMOUNT_CLASS[row.original.type])}>
        {formatCurrency(row.original.grossCents)}
      </span>
    ),
    meta: { className: AMOUNT, sortField: "grossCents" },
  }),
  column.accessor("source", {
    header: () => COLUMN_LABELS.source(),
    cell: ({ getValue }) => BOOKING_SOURCE_LABELS[getValue()](),
    meta: { sortField: "source" },
  }),
]);

export interface BookingTableProps {
  /** The rows of one page, already sorted (by SQL, #21). */
  readonly bookings: readonly BookingListItem[];
  readonly sort: BookingSort;
  readonly onSortChange: (sort: BookingSort) => void;
}

/**
 * The booking list (#17): presentational, renders the given rows in the
 * given order. Clicking a row opens the booking for editing
 * (`/bookings/$bookingId`); for the keyboard, the description is a link.
 *
 * Sorting and pagination (#23) come from the search query (#21), not from
 * the table: the table gets the rows of one page and the sort order. The
 * header of a column with a `sortField` is a button that sorts by it
 * ({@link nextBookingSort}); the sorted column has `aria-sort`. The header
 * sticks to the top of the surrounding scroll box (the table adds no scroll
 * container of its own); the sums are {@link BookingSumsSummary}.
 */
export function BookingTable({ bookings, sort, onSortChange }: BookingTableProps) {
  // A copy: the table only reads the rows but types them as a mutable array.
  const data = useMemo(() => [...bookings], [bookings]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (booking) => String(booking.id),
  });

  return (
    <Table containerClassName="w-full">
      <TableCaption className="sr-only">
        {m.bookings_table_caption({
          column: COLUMN_LABELS[sort.field](),
          direction: DIRECTION_LABELS[sort.direction](),
        })}
      </TableCaption>
      <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const { className, sortField } = header.column.columnDef.meta ?? {};
              const direction =
                sortField !== undefined && sort.field === sortField ? sort.direction : undefined;
              const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;
              return (
                <TableHead
                  key={header.id}
                  className={className}
                  aria-sort={
                    direction === undefined
                      ? undefined
                      : direction === "asc"
                        ? "ascending"
                        : "descending"
                  }
                >
                  {sortField === undefined ? (
                    label
                  ) : (
                    <SortButton
                      sort={sort}
                      field={sortField}
                      alignRight={className === AMOUNT}
                      onSortChange={onSortChange}
                    >
                      {label}
                    </SortButton>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <BookingRow key={row.id} row={row}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </BookingRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortButton({
  children,
  sort,
  field,
  alignRight,
  onSortChange,
}: Readonly<{
  children: ReactNode;
  sort: BookingSort;
  field: BookingSortField;
  /** The arrow goes left of the label, which then lines up with the amounts. */
  alignRight: boolean;
  onSortChange: (sort: BookingSort) => void;
}>) {
  const direction = sort.field === field ? sort.direction : undefined;
  const next = nextBookingSort(sort, field);
  const onClick = () => onSortChange(next);
  const Icon = direction === undefined ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      // The state is the header's `aria-sort`; the tooltip names the action.
      title={m.bookings_sort_action({
        column: COLUMN_LABELS[field](),
        direction: DIRECTION_LABELS[next.direction](),
      })}
      className={cn(
        "group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        alignRight && "flex-row-reverse",
        direction !== undefined && "font-semibold text-foreground",
      )}
    >
      {children}
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          // Like Windows Explorer: only the sorted column shows its arrow;
          // the others show it on hover and keyboard focus.
          direction === undefined &&
            "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
        )}
      />
    </button>
  );
}

/**
 * The sums of all matching bookings (#21, not just this page), shown in the
 * list's footer next to the pagination: income, expense and balance. The
 * balance has a sign and a word (surplus / deficit), not only a colour. The
 * group's name says that the sums cover all pages.
 */
export function BookingSumsSummary({
  sums,
  filtered,
}: Readonly<{ sums: BookingSums; filtered: boolean }>) {
  const balance = sums.balanceCents;
  const caption = filtered ? m.bookings_sums_caption_filtered() : m.bookings_sums_caption_all();
  const items = [
    {
      key: "income",
      label: m.bookings_sums_income(),
      value: formatCurrency(sums.incomeCents),
      className: TYPE_AMOUNT_CLASS.income,
    },
    {
      key: "expense",
      label: m.bookings_sums_expense(),
      value: formatCurrency(sums.expenseCents),
      className: TYPE_AMOUNT_CLASS.expense,
    },
    {
      key: "balance",
      label:
        balance === 0
          ? m.bookings_sums_balance()
          : `${m.bookings_sums_balance()} (${
              balance > 0 ? m.bookings_sums_balance_surplus() : m.bookings_sums_balance_deficit()
            })`,
      value: `${balance > 0 ? "+" : ""}${formatCurrency(balance)}`,
      className: cn(
        "font-semibold",
        balance > 0 && TYPE_AMOUNT_CLASS.income,
        balance < 0 && TYPE_AMOUNT_CLASS.expense,
      ),
    },
  ];
  return (
    <div role="group" aria-label={caption}>
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        {items.map((item) => (
          <div key={item.key} data-sum={item.key} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className={cn("font-semibold tabular-nums", item.className)}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BookingRow({
  children,
  row,
}: Readonly<{ children: ReactNode; row: Row<typeof features, BookingListItem> }>) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    // Clicks on the description link are the link's (incl. Ctrl/Shift/Meta/
    // Alt-clicks, which the router leaves to the browser without preventing
    // the default); a modifier click elsewhere in the row is no plain row
    // click either. Selecting text in a row is no click.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    const selection = window.getSelection();
    const selecting =
      selection?.isCollapsed === false && event.currentTarget.contains(selection.anchorNode);
    if (event.defaultPrevented || selecting) return;
    void navigate({ to: "/bookings/$bookingId", params: { bookingId: row.original.id } });
  };
  return (
    <TableRow interactive data-booking-id={row.original.id} onClick={onClick}>
      {children}
    </TableRow>
  );
}

function BookingTypeBadge({ type }: Readonly<{ type: BookingType }>) {
  const Icon = type === "income" ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={cn("flex items-center gap-1", TYPE_AMOUNT_CLASS[type])}>
      <Icon aria-hidden className="size-3.5" />
      {BOOKING_TYPE_LABELS[type]()}
    </span>
  );
}
