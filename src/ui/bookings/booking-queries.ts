import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type {
  BookingFormInput,
  BookingQuery,
  BookingTextField,
  ExportBookingsCsvRequest,
} from "@/business/bookings";
import type { BookingType } from "@/business/model";
import { categoryQueryKeys } from "@/ui/categories/category-queries";
import { euerQueryKeys } from "@/ui/euer/euer-queries";
import { taxYearQueryKeys } from "@/ui/tax-years/tax-year-queries";

/**
 * TanStack Query keys of the booking data.
 * Hierarchical, so mutations invalidate everything about bookings
 * with `queryClient.invalidateQueries({ queryKey: bookingQueryKeys.all })`
 * – the list and every loaded single booking.
 */
export const bookingQueryKeys = {
  all: ["bookings"] as const,
  /** Every booking list query, whatever its search (prefix of `list(query)`). */
  lists: () => [...bookingQueryKeys.all, "list"] as const,
  /** One booking search (#21): `["bookings", "list", query]`. */
  list: (query: BookingQuery) => [...bookingQueryKeys.lists(), query] as const,
  detail: (id: number) => [...bookingQueryKeys.all, "detail", id] as const,
  /** Text suggestions of the booking form: `["bookings", "suggestions", field, type]`. */
  suggestions: (field: BookingTextField, type: BookingType) =>
    [...bookingQueryKeys.all, "suggestions", field, type] as const,
};

/**
 * One page of the booking search with total count and sums
 * (`BookingService.list`, #21). An invalid query is a result
 * (`{ ok: false, reason: "invalid", errors }`), not a query error.
 *
 * While another search loads (a filter changed, #22), the previous result
 * stays (`isPlaceholderData`), so the list does not flash a loading state
 * on every keystroke – but only a successful one: an `{ ok: false }`
 * result must not stand in for the next query.
 *
 * `enabled: false` skips the query, e.g. while the filters are invalid
 * (the caller shows their errors instead).
 */
export function useBookingList(
  query: BookingQuery,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { bookings } = useAppServices();
  return useQuery({
    queryKey: bookingQueryKeys.list(query),
    queryFn: () => bookings.list(query),
    enabled,
    placeholderData: (previous) => (previous?.ok ? previous : undefined),
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

/**
 * Earlier texts of `field` as suggestions for the booking form
 * (`BookingService.suggestTexts`), those of `type` first. Under
 * `bookingQueryKeys.all`, so every booking change (also the Stripe import)
 * refreshes them. While the suggestions of another
 * type load, the previous ones stay; until the first load there are none –
 * the form does not wait for them.
 */
export function useBookingTextSuggestions(field: BookingTextField, type: BookingType) {
  const { bookings } = useAppServices();
  return useQuery({
    queryKey: bookingQueryKeys.suggestions(field, type),
    queryFn: () => bookings.suggestTexts({ field, type }),
    placeholderData: (previous) => previous,
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
 * details), the categories' `bookingCount`, the tax years with bookings
 * (`TaxYearService.list`) and the EÜR (#26).
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
    [bookingQueryKeys.all, categoryQueryKeys.all, taxYearQueryKeys.all, euerQueryKeys.all].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey, refetchType }),
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

/**
 * CSV export of the booking list (#24): loads all matching bookings, opens
 * the save dialog and writes the file (`BookingExportService.exportCsv`).
 * Reads only, so nothing is invalidated. A cancelled dialog is a result
 * (`saved: false`); a failed write rejects.
 */
export function useBookingCsvExport() {
  const { bookingExport } = useAppServices();
  return useMutation({
    mutationFn: (request: ExportBookingsCsvRequest) => bookingExport.exportCsv(request),
  });
}
