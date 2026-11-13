import { createFileRoute, Link } from "@tanstack/react-router";

import { formatDate } from "@/business/format";
import { m } from "@/paraglide/messages.js";
import { useBooking } from "@/ui/bookings/booking-queries";
import { buttonVariants } from "@/ui/components/ui/button";
import { Page, PagePlaceholder } from "@/ui/layout/page";

/**
 * Editing a booking – opened from the booking list (#17). The form follows
 * with #18 (new bookings: `/buchungen/neu`, a static route that takes
 * precedence over this one).
 *
 * The id is parsed here; anything but a positive decimal integer becomes
 * `NaN`, for which the service answers "not found" without a database query.
 * An unknown booking is shown on this page (no `notFound()`: the root's
 * not-found handling – title via `_notFound` – is for unknown paths).
 */
export const Route = createFileRoute("/buchungen/$bookingId")({
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
    <Page title={m.booking_edit_title()}>
      <EditBooking id={bookingId} />
      <div>
        <Link to="/buchungen" className={buttonVariants({ variant: "outline" })}>
          {m.booking_back_to_list()}
        </Link>
      </div>
    </Page>
  );
}

function EditBooking({ id }: Readonly<{ id: number }>) {
  const { data, error, isPending } = useBooking(id);

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.booking_loading()}
      </p>
    );
  }
  if (error) return <p role="alert">{m.booking_load_error()}</p>;
  if (!data.ok) return <PagePlaceholder>{m.booking_not_found()}</PagePlaceholder>;

  const { booking } = data;
  return (
    <>
      <p>
        <time dateTime={booking.date} className="tabular-nums">
          {formatDate(booking.date)}
        </time>
        {" · "}
        <span className="font-medium">{booking.description}</span>
      </p>
      <PagePlaceholder>{m.booking_edit_placeholder()}</PagePlaceholder>
    </>
  );
}
