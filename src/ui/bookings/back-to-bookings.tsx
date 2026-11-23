import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { m } from "@/paraglide/messages.js";
import { buttonVariants } from "@/ui/components/ui/button";
import { useLastSearches } from "@/ui/layout/last-search";

/** Back to the booking list as it was left (filters, sort order, page). */
export function BackToBookings() {
  const searches = useLastSearches();
  return (
    <Link
      to="/bookings"
      search={searches["/bookings"]}
      aria-label={m.booking_back_to_list()}
      title={m.booking_back_to_list()}
      className={buttonVariants({ variant: "ghost", size: "icon" })}
    >
      <ArrowLeft aria-hidden />
    </Link>
  );
}
