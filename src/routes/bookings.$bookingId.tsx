import { createFileRoute, Link } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { BackToBookings } from "@/ui/bookings/back-to-bookings";
import { BookingForm } from "@/ui/bookings/booking-form";
import { taxYearOf } from "@/ui/bookings/booking-form-model";
import { useBooking } from "@/ui/bookings/booking-queries";
import { useCategoryList } from "@/ui/categories/category-queries";
import { buttonVariants } from "@/ui/components/ui/button";
import { EmptyState, LoadError, LoadingText, Page, PageColumn } from "@/ui/layout/page";
import { useLastSearches } from "@/ui/layout/last-search";
import { useTaxYear } from "@/ui/tax-years/tax-year-queries";

/**
 * Editing a booking (#18) – opened from the booking list (#17). New
 * bookings: `/bookings/new`, a static route that takes precedence over
 * this one.
 *
 * The id is parsed here; anything but a positive decimal integer becomes
 * `NaN` and is shown as "not found" without a query. An unknown booking is
 * shown on this page (no `notFound()`: the root's not-found handling – title
 * via `_notFound` – is for unknown paths).
 */
export const Route = createFileRoute("/bookings/$bookingId")({
  params: {
    parse: ({ bookingId }) => ({
      bookingId: /^[1-9]\d*$/.test(bookingId) ? Number(bookingId) : Number.NaN,
    }),
    stringify: ({ bookingId }) => ({ bookingId: String(bookingId) }),
  },
  component: EditBookingPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.booking_edit_title() }) }] }),
});

function EditBookingPage() {
  const { bookingId } = Route.useParams();
  return (
    <Page title={m.booking_edit_title()} back={<BackToBookings />} stretch>
      {Number.isInteger(bookingId) ? <EditBooking id={bookingId} /> : <BookingNotFound />}
    </Page>
  );
}

function BookingNotFound() {
  const searches = useLastSearches();
  return (
    <PageColumn>
      <EmptyState
        action={
          <Link
            to="/bookings"
            search={searches["/bookings"]}
            className={buttonVariants({ variant: "outline" })}
          >
            {m.booking_back_to_list()}
          </Link>
        }
      >
        {m.booking_not_found()}
      </EmptyState>
    </PageColumn>
  );
}

function EditBooking({ id }: Readonly<{ id: number }>) {
  const booking = useBooking(id);
  const categories = useCategoryList();
  const year = booking.data?.ok ? taxYearOf(booking.data.booking.date) : undefined;
  // Loaded before the form renders, so the VAT field does not flicker.
  const taxYear = useTaxYear(year);

  if (booking.error || categories.error) {
    return (
      <PageColumn>
        <LoadError onRetry={() => void Promise.all([booking.refetch(), categories.refetch()])}>
          {m.booking_load_error()}
        </LoadError>
      </PageColumn>
    );
  }
  if (booking.isPending || categories.isPending || (year !== undefined && taxYear.isPending)) {
    return (
      <PageColumn>
        <LoadingText>{m.booking_loading()}</LoadingText>
      </PageColumn>
    );
  }
  if (!booking.data.ok) return <BookingNotFound />;

  // `key`: a different booking (e.g. navigating between bookings) starts a fresh form.
  return (
    <BookingForm
      key={booking.data.booking.id}
      booking={booking.data.booking}
      categories={categories.data}
    />
  );
}
