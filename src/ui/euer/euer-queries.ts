import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * TanStack Query keys of the EÜR (#26, docs/architecture.md, "TanStack
 * Query"). The EÜR depends on bookings, categories (position and flag at
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
