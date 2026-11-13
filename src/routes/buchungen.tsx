import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Page, PagePlaceholder } from "@/ui/layout/page";

export const Route = createFileRoute("/buchungen")({
  component: BookingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.bookings_title() }) }] }),
});

function BookingsPage() {
  return (
    <Page title={m.bookings_title()}>
      <PagePlaceholder>{m.bookings_placeholder()}</PagePlaceholder>
    </Page>
  );
}
