import { useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useState } from "react";

import type { BookingSearch } from "@/ui/bookings/booking-filter-model";
import type { EuerSearch } from "@/ui/euer/euer-model";

export interface LastSearches {
  readonly "/bookings": BookingSearch;
  readonly "/euer": EuerSearch;
}

const NONE: LastSearches = { "/bookings": {}, "/euer": {} };

const LastSearchContext = createContext<LastSearches>(NONE);

/**
 * Remembers the search params (filters, sort order, page; year) the booking
 * list and the EÜR were last shown with, until the app closes. Links back to
 * them use it, so a detour – editing a booking, another area – does not lose
 * them.
 */
export function LastSearchProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { pathname, search } = useRouterState({ select: (state) => state.location });
  const [searches, setSearches] = useState(NONE);
  if ((pathname === "/bookings" || pathname === "/euer") && searches[pathname] !== search) {
    // The routes validate the params again when they are used.
    setSearches({ ...searches, [pathname]: search });
  }
  return <LastSearchContext value={searches}>{children}</LastSearchContext>;
}

export function useLastSearches(): LastSearches {
  return useContext(LastSearchContext);
}
