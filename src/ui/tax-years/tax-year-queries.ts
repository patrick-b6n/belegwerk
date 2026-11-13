import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * TanStack Query keys of the tax year data (docs/architecture.md, "TanStack
 * Query"). `TaxYearService.list()` includes years that only have bookings,
 * so booking mutations (#18) invalidate `taxYearQueryKeys.all` too; the
 * settings page (#20) invalidates it after changing a year's status.
 */
export const taxYearQueryKeys = {
  all: ["taxYears"] as const,
  list: () => [...taxYearQueryKeys.all, "list"] as const,
  detail: (year: number) => [...taxYearQueryKeys.all, "detail", year] as const,
};

/**
 * The tax status of `year` (`TaxYearService.get`). Without a year (e.g. the
 * date is still incomplete) the query is disabled. While another year
 * loads, the previous result stays (`keepPreviousData`), so dependent UI
 * does not flicker on every date change.
 */
export function useTaxYear(year: number | undefined) {
  const { taxYears } = useAppServices();
  return useQuery({
    queryKey: taxYearQueryKeys.detail(year ?? 0),
    queryFn: () => taxYears.get(year ?? 0),
    enabled: year !== undefined,
    placeholderData: keepPreviousData,
  });
}
