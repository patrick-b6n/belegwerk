import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * TanStack Query keys of the Stripe settings (#28, docs/architecture.md,
 * "TanStack Query"). The cached settings hold the key **masked** only
 * (`StripeSettingsService.get`); the full key is never cached.
 */
export const stripeQueryKeys = {
  all: ["stripe"] as const,
  /** Masked key and stored defaults (`StripeSettingsService.get`). */
  settings: () => [...stripeQueryKeys.all, "settings"] as const,
};

/** The masked key and the stored import defaults. */
export function useStripeSettings() {
  const { stripeSettings } = useAppServices();
  return useQuery({
    queryKey: stripeQueryKeys.settings(),
    queryFn: () => stripeSettings.get(),
  });
}
