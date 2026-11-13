import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";

import { taxYearQueryKeys } from "./tax-year-queries";

/** Arguments of {@link useTaxYearMutations}' `setSmallBusiness`. */
export interface SetSmallBusinessVariables {
  readonly year: number;
  readonly smallBusiness: boolean;
  /** After the user confirmed the conflict dialog. */
  readonly acknowledgeConflicts?: boolean;
}

/**
 * "Jahr hinzufügen" and the Kleinunternehmer switch of the settings page
 * (#20). The mutations return the service's result objects (validation
 * errors and conflicts are results, not errors) and resolve after
 * `taxYearQueryKeys.all` is invalidated – the list and every year's status,
 * which the booking form uses to show or hide the VAT rate. Bookings and
 * categories are not affected (bookings are never rewritten).
 */
export function useTaxYearMutations() {
  const { taxYears } = useAppServices();
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: taxYearQueryKeys.all });

  const addYear = useMutation({
    mutationFn: (year: number) => taxYears.addYear(year),
    onSettled,
  });
  const setSmallBusiness = useMutation({
    mutationFn: ({ year, smallBusiness, acknowledgeConflicts }: SetSmallBusinessVariables) =>
      taxYears.setSmallBusiness(year, smallBusiness, { acknowledgeConflicts }),
    onSettled,
  });
  return { addYear, setSmallBusiness };
}
