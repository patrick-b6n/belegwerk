import { ChevronLeft, ChevronRight } from "lucide-react";
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
 * (#23), on one line: the shown rows of the total, the page size ("100 pro
 * Seite") and previous / "Page X of Y" / next. Buttons that would not move
 * are disabled.
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
      className="ml-auto flex items-center gap-3 text-sm whitespace-nowrap"
    >
      <p className="text-muted-foreground tabular-nums">
        {m.bookings_pagination_range({
          from: String(range.from),
          to: String(range.to),
          total: String(total),
        })}
      </p>
      <label htmlFor={sizeId} className="sr-only">
        {m.bookings_pagination_page_size()}
      </label>
      <Select<string>
        items={BOOKING_PAGE_SIZES.map((size) => ({
          value: String(size),
          label: m.bookings_pagination_per_page({ size: String(size) }),
        }))}
        value={String(pageSize)}
        onValueChange={(value) => {
          if (value !== null) onPageSizeChange(Number(value));
        }}
      >
        <SelectTrigger id={sizeId} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BOOKING_PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {m.bookings_pagination_per_page({ size: String(size) })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center">
        <PageButton
          label={m.bookings_pagination_previous()}
          icon={ChevronLeft}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        <span className="px-1 tabular-nums" aria-live="polite">
          {m.bookings_pagination_page({ page: String(page), count: String(pageCount) })}
        </span>
        <PageButton
          label={m.bookings_pagination_next()}
          icon={ChevronRight}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        />
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
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Stays focusable: on the last page the focused "next" button becomes
      // disabled, and the focus must not fall back to the page.
      focusableWhenDisabled
      onClick={onClick}
    >
      <Icon aria-hidden />
    </Button>
  );
}
