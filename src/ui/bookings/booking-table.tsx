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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";

import { nextBookingSort } from "./booking-filter-model";
import { BOOKING_SOURCE_LABELS, BOOKING_TYPE_LABELS } from "./booking-messages";

/** Classes per column, applied to header and cells (e.g. right-aligned amounts). */
type BookingColumnMeta = { className?: string };

const features = tableFeatures({ columnMeta: metaHelper<BookingColumnMeta>() });
const column = createColumnHelper<typeof features, BookingListItem>();

const AMOUNT = "text-right tabular-nums";

/**
 * Text colour of the gross amount. Never the only signal: the type column
 * names the type and shows an arrow.
 */
const TYPE_AMOUNT_CLASS: Record<BookingType, string> = {
  income: "text-emerald-700 dark:text-emerald-400",
  expense: "text-rose-700 dark:text-rose-400",
};

/** Column names; every column sorts by the search field of its id (#23). */
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
    header: () => m.bookings_column_date(),
    cell: ({ getValue }) => <time dateTime={getValue()}>{formatDate(getValue())}</time>,
    meta: { className: "tabular-nums" },
  }),
  column.accessor("type", {
    header: () => m.bookings_column_type(),
    cell: ({ getValue }) => <BookingTypeBadge type={getValue()} />,
  }),
  column.accessor("description", {
    header: () => m.bookings_column_description(),
    // The description is the row's link: focusable, opens the booking with Enter.
    cell: ({ row }) => (
      <Link
        to="/buchungen/$bookingId"
        params={{ bookingId: row.original.id }}
        title={row.original.description}
        className="block truncate rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {row.original.description}
      </Link>
    ),
    meta: { className: "w-full max-w-0 min-w-36" },
  }),
  column.accessor("counterparty", {
    header: () => m.bookings_column_counterparty(),
    cell: ({ getValue }) => (
      <span title={getValue()} className="block max-w-36 truncate">
        {getValue()}
      </span>
    ),
  }),
  column.accessor((booking) => booking.category.name, {
    id: "category",
    header: () => m.bookings_column_category(),
    cell: ({ row }) => (
      <span title={row.original.category.name} className="flex max-w-40 items-center gap-1.5">
        <span className="truncate">{row.original.category.name}</span>
        {row.original.category.archived && (
          <span className="shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground">
            {m.bookings_category_archived()}
          </span>
        )}
      </span>
    ),
  }),
  column.accessor("netCents", {
    header: () => m.bookings_column_net(),
    cell: ({ getValue }) => formatCurrency(getValue()),
    meta: { className: AMOUNT },
  }),
  column.accessor("vatCents", {
    header: () => m.bookings_column_vat(),
    cell: ({ getValue }) => formatCurrency(getValue()),
    meta: { className: AMOUNT },
  }),
  column.accessor("grossCents", {
    header: () => m.bookings_column_gross(),
    cell: ({ row }) => (
      <span className={cn("font-medium", TYPE_AMOUNT_CLASS[row.original.type])}>
        {formatCurrency(row.original.grossCents)}
      </span>
    ),
    meta: { className: AMOUNT },
  }),
  column.accessor("source", {
    header: () => m.bookings_column_source(),
    cell: ({ getValue }) => BOOKING_SOURCE_LABELS[getValue()](),
  }),
]);

export interface BookingTableProps {
  /** The rows of one page, already sorted (by SQL, #21). */
  readonly bookings: readonly BookingListItem[];
  readonly sort: BookingSort;
  /** A column header was activated: the new sort order. */
  readonly onSortChange: (sort: BookingSort) => void;
  /** Sums of all matching bookings (not just this page), shown in the footer. */
  readonly sums: BookingSums;
  /** Whether filters are active (wording of the sums' label). */
  readonly filtered: boolean;
}

/**
 * The booking list (#17): presentational, renders the given rows in the
 * given order. Clicking a row opens the booking for editing
 * (`/buchungen/$bookingId`); for the keyboard, the description is a link.
 *
 * Sorting, pagination and the sums (#23) come from the search query (#21),
 * not from the table: the table gets the rows of one page, the sort order
 * and the sums of all matching bookings. Every column header is a button
 * that sorts by that column ({@link nextBookingSort}); the sorted column has
 * `aria-sort`.
 */
export function BookingTable({ bookings, sort, onSortChange, sums, filtered }: BookingTableProps) {
  // A copy: the table only reads the rows but types them as a mutable array.
  const data = useMemo(() => [...bookings], [bookings]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (booking) => String(booking.id),
  });

  return (
    <Table>
      <TableCaption className="sr-only">
        {m.bookings_table_caption({
          column: COLUMN_LABELS[sort.field](),
          direction: DIRECTION_LABELS[sort.direction](),
        })}
      </TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const field = header.column.id as BookingSortField;
              const direction = sort.field === field ? sort.direction : undefined;
              return (
                <TableHead
                  key={header.id}
                  className={header.column.columnDef.meta?.className}
                  aria-sort={
                    direction === undefined
                      ? undefined
                      : direction === "asc"
                        ? "ascending"
                        : "descending"
                  }
                >
                  <SortButton sort={sort} field={field} onSortChange={onSortChange} />
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
      <BookingSumsFooter sums={sums} filtered={filtered} />
    </Table>
  );
}

function SortButton({
  sort,
  field,
  onSortChange,
}: Readonly<{
  sort: BookingSort;
  field: BookingSortField;
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
      className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {COLUMN_LABELS[field]()}
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0", direction === undefined && "text-muted-foreground/60")}
      />
    </button>
  );
}

/** Columns before the label cells of the sums (date … category), and after the amount (source). */
const SUMS_LEAD_COLUMNS = 5;

/**
 * The sums of all matching bookings (#21), aligned under the gross column:
 * income, expense and balance. The balance has a sign and a word (surplus /
 * deficit), not only a colour.
 */
function BookingSumsFooter({ sums, filtered }: Readonly<{ sums: BookingSums; filtered: boolean }>) {
  const balance = sums.balanceCents;
  const rows = [
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
    <TableFooter>
      {rows.map((row, index) => (
        <TableRow key={row.key} data-sum={row.key} className="hover:bg-transparent">
          {index === 0 && (
            <TableCell
              rowSpan={rows.length}
              colSpan={SUMS_LEAD_COLUMNS}
              className="align-top text-sm font-normal whitespace-normal text-muted-foreground"
            >
              {filtered ? m.bookings_sums_caption_filtered() : m.bookings_sums_caption_all()}
            </TableCell>
          )}
          <th scope="row" colSpan={2} className="p-2 text-right font-medium whitespace-nowrap">
            {row.label}
          </th>
          <TableCell className={cn(AMOUNT, row.className)}>{row.value}</TableCell>
          <TableCell />
        </TableRow>
      ))}
    </TableFooter>
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
    void navigate({ to: "/buchungen/$bookingId", params: { bookingId: row.original.id } });
  };
  return (
    <TableRow data-booking-id={row.original.id} onClick={onClick} className="cursor-pointer">
      {children}
    </TableRow>
  );
}

function BookingTypeBadge({ type }: Readonly<{ type: BookingType }>) {
  const Icon = type === "income" ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        type === "income"
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {BOOKING_TYPE_LABELS[type]()}
    </span>
  );
}
