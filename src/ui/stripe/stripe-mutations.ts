import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type {
  SetStripeApiKeyResult,
  StripeDefaultsInput,
  StripeImportRequest,
  StripeImportResult,
} from "@/business/stripe";
import { bookingQueryKeys } from "@/ui/bookings/booking-queries";
import { categoryQueryKeys } from "@/ui/categories/category-queries";
import { euerQueryKeys } from "@/ui/euer/euer-queries";
import { taxYearQueryKeys } from "@/ui/tax-years/tax-year-queries";

import { stripeImportQueryKeys, stripeQueryKeys } from "./stripe-queries";

/**
 * Changes of the Stripe settings (#28). All invalidate only
 * `stripeQueryKeys.all`: bookings, categories, tax years and the EÜR do not
 * depend on these settings. They return the service's result objects
 * (validation errors are results, not errors).
 *
 * Saving the key is **no** `useMutation`: TanStack Query keeps a mutation's
 * variables in its cache (`mutation.state.variables`), and the full key must
 * not stay in memory longer than the call. `saveApiKey` calls the service
 * directly and then invalidates.
 */
export function useStripeSettingsMutations() {
  const { stripeSettings } = useAppServices();
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: stripeQueryKeys.all });

  const saveApiKey = async (apiKey: string): Promise<SetStripeApiKeyResult> => {
    try {
      return await stripeSettings.setApiKey(apiKey);
    } finally {
      await onSettled();
    }
  };
  const deleteApiKey = useMutation({
    mutationFn: () => stripeSettings.deleteApiKey(),
    onSettled,
  });
  const setDefaults = useMutation({
    mutationFn: (input: StripeDefaultsInput) => stripeSettings.setDefaults(input),
    onSettled,
  });
  // Changes nothing, so no invalidation.
  const testConnection = useMutation({ mutationFn: () => stripeSettings.testConnection() });
  return { saveApiKey, deleteApiKey, setDefaults, testConnection };
}

/**
 * The Stripe import (#31, `StripeImportService.import`). Resolves with the
 * service's result (an invalid period, a missing key or a Stripe error are
 * results); rejects only on an unexpected error (rolled back, nothing
 * booked).
 *
 * After a successful import it invalidates what new bookings affect – like
 * a booking change (#18): bookings, the categories' `bookingCount`, the tax
 * years with bookings, the EÜR – and the import status (default period).
 * Missing key, invalid defaults or changed settings mean the cached settings
 * are stale: those invalidate `stripeQueryKeys.all`, so the dialog shows the
 * current state.
 */
export function useStripeImport() {
  const { stripeImport } = useAppServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StripeImportRequest) => stripeImport.import(request),
    onSuccess: (result: StripeImportResult) => {
      const keys = result.ok
        ? [
            bookingQueryKeys.all,
            categoryQueryKeys.all,
            taxYearQueryKeys.all,
            euerQueryKeys.all,
            stripeImportQueryKeys.all,
          ]
        : result.reason === "noApiKey" ||
            result.reason === "invalidDefaults" ||
            result.reason === "settingsChanged"
          ? [stripeQueryKeys.all]
          : [];
      return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
        () => undefined,
      );
    },
  });
}
