import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "cn";
import { BookOpenText, Calculator, type LucideIcon, Settings, Tags } from "lucide-react";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";
import iconUrl from "@/ui/assets/brand/icon.svg";
import wordmarkUrl from "@/ui/assets/brand/wordmark.svg";
import { UpdateNotice } from "@/ui/updates/update-notice";

/** Id of the scrolling content area (scroll reset in src/router.tsx, skip link). */
export const APP_CONTENT_ID = "app-content";

/** Id of the settings link (focus target after the update notice is dismissed). */
export const SETTINGS_LINK_ID = "app-settings-link";

type NavItem = {
  icon: LucideIcon;
  label: () => string;
  to: LinkProps["to"];
};

/**
 * A top-navigation item (Fluent): muted text, a subtle fill on hover; the
 * active one in the foreground colour with a 16×3 px accent line at the
 * bottom of the bar (each item sets the offset that puts it there).
 */
const NAV_ITEM =
  "relative flex items-center rounded-md text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:text-foreground data-[status=active]:after:absolute data-[status=active]:after:left-1/2 data-[status=active]:after:h-[3px] data-[status=active]:after:w-4 data-[status=active]:after:-translate-x-1/2 data-[status=active]:after:rounded-full data-[status=active]:after:bg-sidebar-primary";

const mainItems: NavItem[] = [
  { icon: BookOpenText, label: m.bookings_title, to: "/bookings" },
  { icon: Calculator, label: m.euer_title, to: "/euer" },
  { icon: Tags, label: m.categories_title, to: "/categories" },
];

/**
 * App layout in the style of a Windows 11 app (Fluent top navigation): a top
 * bar (logo, main navigation, update notice, settings) in the sidebar colour
 * and the content layer below it, flush with the window edges, which scrolls
 * on its own. The active item is marked by a short accent line below it.
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
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <div className="flex items-center gap-2.5 pr-4">
          <img src={iconUrl} alt="" className="size-5" />
          <img src={wordmarkUrl} alt={m.app_title()} className="h-4.5" />
        </div>
        <nav aria-label={m.nav_label()} className="flex min-w-0 flex-1 items-center gap-2">
          <ul className="flex items-center">
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
              id={SETTINGS_LINK_ID}
              to="/settings"
              aria-label={m.settings_title()}
              title={m.settings_title()}
              className={cn(NAV_ITEM, "size-8 justify-center data-[status=active]:after:-bottom-2")}
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
        className="min-h-0 flex-1 overflow-auto border-t bg-background text-foreground outline-none"
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
      className={cn(
        NAV_ITEM,
        "h-10 gap-2 px-3 data-[status=active]:font-semibold data-[status=active]:after:-bottom-1",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label()}
    </Link>
  );
}
