import { createFileRoute, redirect } from "@tanstack/react-router";

// The bookings list is the start page. Redirecting (instead of rendering it at
// "/") keeps one canonical URL for it, so its search params (filters, #22) and
// the active state in the navigation only exist under /buchungen.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ replace: true, to: "/buchungen" });
  },
});
