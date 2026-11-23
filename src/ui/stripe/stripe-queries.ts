import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * The cached settings hold the key **masked** only
 * (`StripeSettingsService.get`); the full key is never cached.
 */
export const stripeQueryKeys = {
  all: ["stripe"] as const,
  settings: () => [...stripeQueryKeys.all, "settings"] as const,
};

export function useStripeSettings() {
  const { stripeSettings } = useAppServices();
  return useQuery({
    queryKey: stripeQueryKeys.settings(),
    queryFn: () => stripeSettings.get(),
  });
}

/** The status changes only with an import (`useStripeImport` invalidates it). */
export const stripeImportQueryKeys = {
  all: ["stripeImport"] as const,
  status: () => [...stripeImportQueryKeys.all, "status"] as const,
};

export function useStripeImportStatus() {
  const { stripeImport } = useAppServices();
  return useQuery({
    queryKey: stripeImportQueryKeys.status(),
    queryFn: () => stripeImport.getStatus(),
  });
}
