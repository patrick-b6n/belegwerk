import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type { CategoryFormChanges, CategoryFormInput } from "@/business/categories";
import { bookingQueryKeys } from "@/ui/bookings/booking-queries";

import { categoryQueryKeys } from "./category-queries";

/**
 * Invalidates everything a category change can affect: the categories and
 * the bookings (list rows and loaded bookings show the category's name and
 * "archived" mark; the booking form's options come from the category list).
 *
 * In its own module (not `category-queries.ts`): `booking-queries.ts` imports
 * the category keys, so this keeps the imports free of cycles.
 */
function invalidateAfterCategoryChange(queryClient: QueryClient): Promise<void> {
  return Promise.all(
    [categoryQueryKeys.all, bookingQueryKeys.all].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  ).then(() => undefined);
}

/**
 * Create, update, archive, reactivate and delete (#19). The mutations return
 * the service's result objects (validation errors, "not found", "system
 * category" and "in use" are results, not errors) and resolve after the
 * affected queries are invalidated – also after a failed result, since it may
 * mean the cached list is stale.
 */
export function useCategoryMutations() {
  const { categories } = useAppServices();
  const queryClient = useQueryClient();
  const onSettled = () => invalidateAfterCategoryChange(queryClient);

  const create = useMutation({
    mutationFn: (input: CategoryFormInput) => categories.create(input),
    onSettled,
  });
  const update = useMutation({
    mutationFn: ({ id, changes }: { id: number; changes: CategoryFormChanges }) =>
      categories.update(id, changes),
    onSettled,
  });
  const archive = useMutation({
    mutationFn: (id: number) => categories.archive(id),
    onSettled,
  });
  const reactivate = useMutation({
    mutationFn: (id: number) => categories.reactivate(id),
    onSettled,
  });
  const remove = useMutation({
    mutationFn: (id: number) => categories.delete(id),
    onSettled,
  });
  return { create, update, archive, reactivate, remove };
}
