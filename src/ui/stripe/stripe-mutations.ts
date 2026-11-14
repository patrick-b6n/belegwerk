import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type { SetStripeApiKeyResult, StripeDefaultsInput } from "@/business/stripe";

import { stripeQueryKeys } from "./stripe-queries";

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
