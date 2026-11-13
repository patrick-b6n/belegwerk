import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: m.app_title() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  // Rendered inside the shell (in place of <Outlet />) for unknown paths.
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <RootDocument>
      <AppShell>
        <Outlet />
      </AppShell>
    </RootDocument>
  );
}

function NotFound() {
  return (
    <Page title={m.not_found_title()}>
      <PagePlaceholder>{m.not_found_description()}</PagePlaceholder>
      <div>
        <Link to="/buchungen" className={buttonVariants({ variant: "outline" })}>
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
