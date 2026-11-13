import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { BookingForm } from "@/ui/bookings/booking-form";
import { taxYearOf, todayIsoDate } from "@/ui/bookings/booking-form-model";
import { useCategoryList } from "@/ui/categories/category-queries";
import { Page } from "@/ui/layout/page";
import { useTaxYear } from "@/ui/tax-years/tax-year-queries";

/** A new booking (#18). Static route: takes precedence over `/buchungen/$bookingId`. */
export const Route = createFileRoute("/buchungen/neu")({
  component: NewBookingPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.booking_new_title() }) }] }),
});

function NewBookingPage() {
  return (
    <Page title={m.booking_new_title()}>
      <NewBooking />
    </Page>
  );
}

function NewBooking() {
  const categories = useCategoryList();
  // The form starts with today; its tax year is loaded first so the VAT
  // field does not flicker.
  const [year] = useState(() => taxYearOf(todayIsoDate()));
  const taxYear = useTaxYear(year);

  if (categories.error) return <p role="alert">{m.booking_form_load_error()}</p>;
  if (categories.isPending || (year !== undefined && taxYear.isPending)) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.booking_form_loading()}
      </p>
    );
  }
  return <BookingForm categories={categories.data} />;
}
