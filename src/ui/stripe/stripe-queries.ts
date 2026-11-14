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

/**
 * TanStack Query keys of the Stripe import (#31). The status changes only
 * with an import (`useStripeImport` invalidates it).
 */
export const stripeImportQueryKeys = {
  all: ["stripeImport"] as const,
  /** Last import (`StripeImportService.getStatus`), for the default period. */
  status: () => [...stripeImportQueryKeys.all, "status"] as const,
};

/** When the last import ran and up to which day („seit dem letzten Import“). */
export function useStripeImportStatus() {
  const { stripeImport } = useAppServices();
  return useQuery({
    queryKey: stripeImportQueryKeys.status(),
    queryFn: () => stripeImport.getStatus(),
  });
}
