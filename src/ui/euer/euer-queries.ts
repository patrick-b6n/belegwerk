import { useMutation, useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type { ExportEuerCsvRequest } from "@/business/euer";

/**
 * TanStack Query keys of the EÜR (#26).
 * The EÜR depends on bookings, categories (position and flag at
 * calculation time, #15) and the tax status of the year, so booking,
 * category and tax year mutations invalidate `euerQueryKeys.all`.
 */
export const euerQueryKeys = {
  all: ["euer"] as const,
  year: (year: number) => [...euerQueryKeys.all, "year", year] as const,
};

/** The EÜR of `year` (`EuerService.calculate`); an invalid year is a result, not an error. */
export function useEuer(year: number) {
  const { euer } = useAppServices();
  return useQuery({
    queryKey: euerQueryKeys.year(year),
    queryFn: () => euer.calculate(year),
  });
}

/** CSV export of a year's EÜR (#27); nothing to invalidate (reads only). */
export function useEuerCsvExport() {
  const { euerExport } = useAppServices();
  return useMutation({
    mutationFn: (request: ExportEuerCsvRequest) => euerExport.exportCsv(request),
  });
}
