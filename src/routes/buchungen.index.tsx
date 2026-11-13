import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";
import { useBookingList } from "@/ui/bookings/booking-queries";
import { BookingTable } from "@/ui/bookings/booking-table";
import { Page, PagePlaceholder } from "@/ui/layout/page";

/**
 * The booking list (#17). Filters, sorting and page follow as validated
 * search params on this route (`validateSearch`, #22/#23) and go into the
 * list query (#21).
 */
export const Route = createFileRoute("/buchungen/")({
  component: BookingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.bookings_title() }) }] }),
});

function BookingsPage() {
  return (
    <Page title={m.bookings_title()}>
      <BookingList />
    </Page>
  );
}

function BookingList() {
  const { data, error, isPending, refetch } = useBookingList();

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.bookings_loading()}
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.bookings_load_error()}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  if (data.items.length === 0) {
    return <PagePlaceholder>{m.bookings_empty()}</PagePlaceholder>;
  }
  return <BookingTable bookings={data.items} />;
}
