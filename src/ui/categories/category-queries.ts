import { useQuery } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

/**
 * The list carries each category's `bookingCount`, so booking
 * mutations (#18) invalidate `categoryQueryKeys.all` as well; the category
 * management (#19) invalidates it after its own changes.
 */
export const categoryQueryKeys = {
  all: ["categories"] as const,
  list: () => [...categoryQueryKeys.all, "list"] as const,
};

export function useCategoryList() {
  const { categories } = useAppServices();
  return useQuery({
    queryKey: categoryQueryKeys.list(),
    queryFn: () => categories.list(),
  });
}
