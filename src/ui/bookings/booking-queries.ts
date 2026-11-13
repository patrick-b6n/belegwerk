import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * TanStack Query keys of the booking data (docs/architecture.md, "TanStack
 * Query"). Hierarchical, so mutations (#18) invalidate everything about
 * bookings with `queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all })`
 * – the list and every loaded single booking.
 */
export const bookingQueryKeys = {
  all: ["bookings"] as const,
  /**
   * The booking list. The search (#21/#22) appends its query object
   * (`["bookings", "list", query]`); `all` and this prefix still match.
   */
  list: () => [...bookingQueryKeys.all, "list"] as const,
  detail: (id: number) => [...bookingQueryKeys.all, "detail", id] as const,
};

/** All bookings with their category, newest first (`BookingService.list`). */
export function useBookingList() {
  const { bookings } = useAppServices();
  return useQuery({
    queryKey: bookingQueryKeys.list(),
    queryFn: () => bookings.list(),
  });
}

/** One booking (`BookingService.get`); `{ ok: false, reason: "notFound" }` if it does not exist. */
export function useBooking(id: number) {
  const { bookings } = useAppServices();
  return useQuery({
    queryKey: bookingQueryKeys.detail(id),
    queryFn: () => bookings.get(id),
  });
}
