import {
  createColumnHelper,
  metaHelper,
  tableFeatures,
  useTable,
  type Row,
} from "@tanstack/react-table";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import type { BookingListItem } from "@/business/bookings";
import { formatCurrency, formatDate } from "@/business/format";
import type { BookingSource, BookingType } from "@/business/model";
import { m } from "@/paraglide/messages.js";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";

/** Classes per column, applied to header and cells (e.g. right-aligned amounts). */
type BookingColumnMeta = { className?: string };

const features = tableFeatures({ columnMeta: metaHelper<BookingColumnMeta>() });
const column = createColumnHelper<typeof features, BookingListItem>();

const AMOUNT = "text-right tabular-nums";

const TYPE_LABELS: Record<BookingType, () => string> = {
  income: m.bookings_type_income,
  expense: m.bookings_type_expense,
};

const SOURCE_LABELS: Record<BookingSource, () => string> = {
  manual: m.bookings_source_manual,
  stripe: m.bookings_source_stripe,
};

/**
 * Text colour of the gross amount. Never the only signal: the type column
 * names the type and shows an arrow.
 */
const TYPE_AMOUNT_CLASS: Record<BookingType, string> = {
  income: "text-emerald-700 dark:text-emerald-400",
  expense: "text-rose-700 dark:text-rose-400",
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
    cell: ({ getValue }) => SOURCE_LABELS[getValue()](),
  }),
]);

/**
 * The booking list (#17): presentational, renders the given rows in the
 * given order. Clicking a row opens the booking for editing
 * (`/buchungen/$bookingId`); for the keyboard, the description is a link.
 *
 * Sorting, pagination and the sum row (#23) come from the search query
 * (#21), not from the table: the table gets the rows of one page.
 */
export function BookingTable({ bookings }: Readonly<{ bookings: readonly BookingListItem[] }>) {
  const table = useTable({
    features,
    columns,
    data: bookings as BookingListItem[],
    getRowId: (booking) => String(booking.id),
  });

  return (
    <Table>
      <TableCaption className="sr-only">{m.bookings_table_caption()}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHead>
            ))}
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

function BookingRow({
  children,
  row,
}: Readonly<{ children: ReactNode; row: Row<typeof features, BookingListItem> }>) {
  const navigate = useNavigate();
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    // The description link navigates itself (and prevents the default);
    // selecting text in a row is no click.
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
      {TYPE_LABELS[type]()}
    </span>
  );
}
