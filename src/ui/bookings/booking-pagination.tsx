import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ComponentType } from "react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";

import { BOOKING_PAGE_SIZES, pageRange } from "./booking-filter-model";

export interface BookingPaginationProps {
  /** The page shown (1-based), as returned by the search. */
  readonly page: number;
  /** At least 1. */
  readonly pageCount: number;
  readonly pageSize: number;
  /** Number of all matching bookings. */
  readonly total: number;
  /** Id prefix of the page-size select. */
  readonly id: string;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}

/**
 * Pagination in the footer of the booking list's box, right of the sums
 * (#23): first / previous / next / last page, "Page X of Y", the shown rows
 * of the total and the page size. Buttons that would not move are disabled.
 */
export function BookingPagination({
  page,
  pageCount,
  pageSize,
  total,
  id,
  onPageChange,
  onPageSizeChange,
}: BookingPaginationProps) {
  const range = pageRange(page, pageSize, total);
  const sizeId = `${id}-page-size`;
  return (
    <nav
      aria-label={m.bookings_pagination_label()}
      className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm"
    >
      <p className="text-muted-foreground tabular-nums">
        {m.bookings_pagination_range({
          from: String(range.from),
          to: String(range.to),
          total: String(total),
        })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={sizeId} className="text-muted-foreground">
            {m.bookings_pagination_page_size()}
          </label>
          <Select<string>
            items={BOOKING_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value !== null) onPageSizeChange(Number(value));
            }}
          >
            <SelectTrigger id={sizeId} size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOOKING_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <PageButton
            label={m.bookings_pagination_first()}
            icon={ChevronsLeft}
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          />
          <PageButton
            label={m.bookings_pagination_previous()}
            icon={ChevronLeft}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          />
          <span className="px-2 tabular-nums" aria-live="polite">
            {m.bookings_pagination_page({ page: String(page), count: String(pageCount) })}
          </span>
          <PageButton
            label={m.bookings_pagination_next()}
            icon={ChevronRight}
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          />
          <PageButton
            label={m.bookings_pagination_last()}
            icon={ChevronsRight}
            disabled={page >= pageCount}
            onClick={() => onPageChange(pageCount)}
          />
        </div>
      </div>
    </nav>
  );
}

function PageButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: Readonly<{
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  disabled: boolean;
  onClick: () => void;
}>) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Stays focusable: after "Letzte Seite" the focused button becomes
      // disabled, and the focus must not fall back to the page.
      focusableWhenDisabled
      className="data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <Icon aria-hidden />
    </Button>
  );
}
