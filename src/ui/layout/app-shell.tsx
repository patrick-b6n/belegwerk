import { Link, type LinkProps } from "@tanstack/react-router";
import { BookOpenText, Calculator, type LucideIcon, Settings, Tags } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";
import iconUrl from "@/ui/assets/brand/icon.svg";
import wordmarkUrl from "@/ui/assets/brand/wordmark.svg";
import { UpdateNotice } from "@/ui/updates/update-notice";

/** Id of the scrolling content area (scroll reset in src/router.tsx, skip link). */
export const APP_CONTENT_ID = "app-content";

type NavItem = {
  icon: LucideIcon;
  label: () => string;
  to: LinkProps["to"];
};

const mainItems: NavItem[] = [
  { icon: BookOpenText, label: m.bookings_title, to: "/bookings" },
  { icon: Calculator, label: m.euer_title, to: "/euer" },
  { icon: Tags, label: m.categories_title, to: "/categories" },
];

/**
 * App layout: a top bar (logo, main navigation, update notice, settings) and
 * the active area below it. Bar and a thin margin form a frame in the sidebar
 * colour around the content panel, which scrolls on its own.
 */
export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex h-svh flex-col bg-sidebar text-sidebar-foreground">
      <a
        href={`#${APP_CONTENT_ID}`}
        onClick={(event) => {
          // Focus the content without adding a hash/history entry; the href
          // stays as fallback.
          event.preventDefault();
          document.getElementById(APP_CONTENT_ID)?.focus();
        }}
        className="sr-only rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2 focus:ring-ring"
      >
        {m.nav_skip_to_content()}
      </a>
      <header className="flex h-11 shrink-0 items-center gap-4 px-3">
        <div className="flex items-center gap-2 pr-2">
          <img src={iconUrl} alt="" className="size-6" />
          <img src={wordmarkUrl} alt={m.app_title()} className="h-5" />
        </div>
        <nav aria-label={m.nav_label()} className="flex min-w-0 flex-1 items-center gap-3">
          <ul className="flex items-center gap-0.5">
            {mainItems.map((item) => (
              <li key={item.to}>
                <NavLink item={item} />
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            {/* Newer version available (#71); background check at startup. */}
            <UpdateNotice />
            <Link
              to="/settings"
              aria-label={m.settings_title()}
              title={m.settings_title()}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[status=active]:bg-background data-[status=active]:text-foreground data-[status=active]:shadow-xs data-[status=active]:ring-1 data-[status=active]:ring-border"
            >
              <Settings aria-hidden className="size-4" />
            </Link>
          </div>
        </nav>
      </header>
      <div
        id={APP_CONTENT_ID}
        data-scroll-restoration-id={APP_CONTENT_ID}
        tabIndex={-1}
        className="mx-1.5 mb-1.5 min-h-0 flex-1 overflow-auto rounded-lg border bg-background text-foreground outline-none"
      >
        {children}
      </div>
    </div>
  );
}

function NavLink({ item: { icon: Icon, label, to } }: Readonly<{ item: NavItem }>) {
  return (
    <Link
      to={to}
      className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[status=active]:bg-background data-[status=active]:font-medium data-[status=active]:text-foreground data-[status=active]:shadow-xs data-[status=active]:ring-1 data-[status=active]:ring-border"
    >
      <Icon aria-hidden className="size-4" />
      {label()}
    </Link>
  );
}
