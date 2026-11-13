import { QueryClient } from "@tanstack/react-query";

/**
 * Creates the app-wide TanStack Query client.
 *
 * All data comes from the local SQLite database in the same process, so:
 * - `retry: false` – a failing query will fail again; surface the error at once.
 * - `refetchOnWindowFocus: false` – nothing changes outside the app while it
 *   is in the background.
 *
 * `staleTime` stays at the default (0): local queries are cheap, and data is
 * refetched when a page mounts. Mutations invalidate the affected queries.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  });
}
