import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { BookingForm } from "@/ui/bookings/booking-form";
import { taxYearOf, todayIsoDate } from "@/ui/bookings/booking-form-model";
import { useCategoryList } from "@/ui/categories/category-queries";
import { BackToBookings } from "@/ui/bookings/back-to-bookings";
import { LoadError, LoadingText, Page, PageColumn } from "@/ui/layout/page";
import { useTaxYear } from "@/ui/tax-years/tax-year-queries";

/** A new booking (#18). Static route: takes precedence over `/bookings/$bookingId`. */
export const Route = createFileRoute("/bookings/new")({
  component: NewBookingPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.booking_new_title() }) }] }),
});

function NewBookingPage() {
  return (
    <Page title={m.booking_new_title()} back={<BackToBookings />} stretch>
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

  if (categories.error) {
    return (
      <PageColumn>
        <LoadError onRetry={() => void categories.refetch()}>
          {m.booking_form_load_error()}
        </LoadError>
      </PageColumn>
    );
  }
  if (categories.isPending || (year !== undefined && taxYear.isPending)) {
    return (
      <PageColumn>
        <LoadingText>{m.booking_form_loading()}</LoadingText>
      </PageColumn>
    );
  }
  return <BookingForm categories={categories.data} />;
}
