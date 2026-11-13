import { Link, type LinkProps } from "@tanstack/react-router";
import { BookOpenText, Calculator, type LucideIcon, Settings, Tags } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";

/** Id of the scrolling content area (scroll reset in src/router.tsx, skip link). */
export const APP_CONTENT_ID = "app-content";

type NavItem = {
  icon: LucideIcon;
  label: () => string;
  to: LinkProps["to"];
};

const mainItems: NavItem[] = [
  { icon: BookOpenText, label: m.bookings_title, to: "/buchungen" },
  { icon: Calculator, label: m.euer_title, to: "/euer" },
  { icon: Tags, label: m.categories_title, to: "/kategorien" },
];

const footerItems: NavItem[] = [{ icon: Settings, label: m.settings_title, to: "/einstellungen" }];

/** App layout: fixed side navigation on the left, the active area on the right. */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex h-svh">
      <a
        href={`#${APP_CONTENT_ID}`}
        className="sr-only rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2 focus:ring-ring"
      >
        {m.nav_skip_to_content()}
      </a>
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r bg-sidebar p-3 text-sidebar-foreground">
        <div className="px-2 py-1 font-heading text-lg font-semibold">{m.app_title()}</div>
        <nav aria-label={m.nav_label()} className="flex flex-1 flex-col">
          <NavList items={mainItems} />
          <div className="mt-auto">
            <NavList items={footerItems} />
          </div>
        </nav>
      </aside>
      <div
        id={APP_CONTENT_ID}
        data-scroll-restoration-id={APP_CONTENT_ID}
        tabIndex={-1}
        className="min-w-0 flex-1 overflow-auto outline-none"
      >
        {children}
      </div>
    </div>
  );
}

function NavList({ items }: Readonly<{ items: NavItem[] }>) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ icon: Icon, label, to }) => (
        <li key={to}>
          <Link
            to={to}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground"
          >
            <Icon aria-hidden className="size-4" />
            {label()}
          </Link>
        </li>
      ))}
    </ul>
  );
}
