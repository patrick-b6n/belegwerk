import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { createQueryClient } from "@/app/query-client";
import { APP_CONTENT_ID } from "@/ui/layout/app-shell";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // One client per router instance (the SPA shell is prerendered in its own
  // instance). It is also passed as router context so loaders can prefetch
  // (`context.queryClient.ensureQueryData(...)`).
  const queryClient = createQueryClient();

  return createRouter({
    context: { queryClient },
    routeTree,
    scrollRestoration: true,
    // The content area scrolls, not the window: reset it on navigation.
    scrollToTopSelectors: [`#${APP_CONTENT_ID}`],
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
