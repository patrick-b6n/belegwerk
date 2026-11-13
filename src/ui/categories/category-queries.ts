import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * TanStack Query keys of the category data (docs/architecture.md, "TanStack
 * Query"). The list carries each category's `bookingCount`, so booking
 * mutations (#18) invalidate `categoryQueryKeys.all` as well; the category
 * management (#19) invalidates it after its own changes.
 */
export const categoryQueryKeys = {
  all: ["categories"] as const,
  /** All categories including archived ones, with booking counts (`CategoryService.list`). */
  list: () => [...categoryQueryKeys.all, "list"] as const,
};

/** All categories including archived ones, ordered by id, each with its booking count. */
export function useCategoryList() {
  const { categories } = useAppServices();
  return useQuery({
    queryKey: categoryQueryKeys.list(),
    queryFn: () => categories.list(),
  });
}
