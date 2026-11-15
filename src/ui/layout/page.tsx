import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Content of an area. Like a Windows 11 app with top navigation it shows no
 * visible page title (the active navigation item says where you are); the
 * `title` is the page's `h1` for screen readers. `actions` sit right-aligned
 * above the content. Uses the full width of the content panel; forms limit
 * their own width.
 *
 * `fill`: the page takes the panel's height and the content is a flex column
 * whose last child can scroll on its own (`min-h-0 flex-1`), e.g. a table with
 * a sticky header and the pagination below it.
 *
 * `stretch`: the page is at least as high as the panel and its content grows
 * to fill it, e.g. so a form's command bar sits at the bottom of the window.
 *
 * `compact`: narrow margins for dense pages such as the booking list, which
 * puts its actions into its own toolbar instead of `actions`.
 */
export function Page({
  actions,
  children,
  compact = false,
  fill = false,
  stretch = false,
  title,
}: Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  fill?: boolean;
  stretch?: boolean;
  title: string;
}>) {
  return (
    <main className={cn("flex flex-col", fill && "h-full", stretch && "min-h-full")}>
      <h1 className="sr-only">{title}</h1>
      {actions && (
        <div
          className={cn(
            "flex shrink-0 flex-wrap justify-end gap-2 px-8 pt-6",
            compact && "px-4 pt-3",
          )}
        >
          {actions}
        </div>
      )}
      <div
        className={cn(
          "flex flex-col gap-4 px-8 pb-6",
          actions ? "pt-4" : "pt-6",
          compact && "gap-3 px-4 pt-3 pb-3",
          fill && "min-h-0 flex-1",
          stretch && "flex-1",
        )}
      >
        {children}
      </div>
    </main>
  );
}

/** Placeholder text for areas that are not implemented yet. */
export function PagePlaceholder({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-muted-foreground">{children}</p>;
}
