import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type { BookingFormInput } from "@/business/bookings";
import { categoryQueryKeys } from "@/ui/categories/category-queries";
import { taxYearQueryKeys } from "@/ui/tax-years/tax-year-queries";

/**
 * TanStack Query keys of the booking data (docs/architecture.md, "TanStack
 * Query"). Hierarchical, so mutations invalidate everything about bookings
 * with `queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all })`
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

/**
 * One booking (`BookingService.get`); `{ ok: false, reason: "notFound" }` if
 * it does not exist. Only for integer ids: the query key of `NaN` would be
 * `["bookings", "detail", null]` (JSON), shared by every invalid id – callers
 * render "not found" for those without querying.
 */
export function useBooking(id: number) {
  const { bookings } = useAppServices();
  return useQuery({
    queryKey: bookingQueryKeys.detail(id),
    queryFn: () => bookings.get(id),
    enabled: Number.isInteger(id),
  });
}

type MutationResult = { readonly ok: boolean; readonly reason?: string } | undefined;

/**
 * Whether the form leaves the page after this result: after a successful
 * change and after "not found" it returns to the list; after failed
 * validation or an unexpected error it stays.
 */
function leavesPage(result: MutationResult): boolean {
  return result !== undefined && (result.ok || result.reason === "notFound");
}

/**
 * Invalidates everything a booking change can affect: bookings (list and
 * details), the categories' `bookingCount` and the tax years with bookings
 * (`TaxYearService.list`).
 *
 * When the form leaves the page, only inactive queries are refetched (e.g.
 * the list it returns to); the active ones of the form page are only marked
 * stale – refetching them would e.g. show a just deleted booking as "not
 * found" before the navigation. Otherwise the active ones are refetched.
 */
function invalidateAfterBookingChange(
  queryClient: QueryClient,
  result: MutationResult,
): Promise<void> {
  const refetchType = leavesPage(result) ? "inactive" : "active";
  return Promise.all(
    [bookingQueryKeys.all, categoryQueryKeys.all, taxYearQueryKeys.all].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, refetchType }),
    ),
  ).then(() => undefined);
}

/**
 * Create, update and delete (#18). The mutations return the service's result
 * objects (validation errors and "not found" are results, not errors) and
 * resolve after the affected queries are invalidated – also after a failed
 * validation or "not found", since both may mean the cached data is stale.
 */
export function useBookingMutations() {
  const { bookings } = useAppServices();
  const queryClient = useQueryClient();
  const onSettled = (result: MutationResult) => invalidateAfterBookingChange(queryClient, result);

  const create = useMutation({
    mutationFn: (input: BookingFormInput) => bookings.create(input),
    onSettled,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: number; input: BookingFormInput }) =>
      bookings.update(id, input),
    onSettled,
  });
  const remove = useMutation({
    mutationFn: (id: number) => bookings.delete(id),
    onSettled,
  });
  return { create, update, remove };
}
