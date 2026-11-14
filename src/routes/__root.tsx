import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppServicesProvider } from "@/app/app-services";
import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";
import { buttonVariants } from "@/ui/components/ui/button";
import { Toaster } from "@/ui/components/ui/toast";
import { AppShell } from "@/ui/layout/app-shell";
import { Page, PagePlaceholder } from "@/ui/layout/page";
import appCss from "@/ui/styles/globals.css?url";

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Child routes override the title. For unknown paths (also below an
      // existing route, e.g. /bookings/x) the router renders the root's
      // notFoundComponent and flags the root match with `_notFound` (public
      // field of RouteMatch, despite the underscore).
      {
        // oxlint-disable-next-line no-underscore-dangle
        title: match._notFound ? m.page_title({ page: m.not_found_title() }) : m.app_title(),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  // Rendered inside the shell (in place of <Outlet />) for unknown paths.
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      {/* Opens the database before the app renders; error screen on failure. */}
      <AppServicesProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </AppServicesProvider>
    </RootDocument>
  );
}

function NotFound() {
  return (
    <Page title={m.not_found_title()}>
      <PagePlaceholder>{m.not_found_description()}</PagePlaceholder>
      <div>
        <Link to="/bookings" className={buttonVariants({ variant: "outline" })}>
          {m.not_found_back()}
        </Link>
      </div>
    </Page>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        <Toaster>{children}</Toaster>
        <Scripts />
      </body>
    </html>
  );
}
