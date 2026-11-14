import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Content of an area: a compact header bar (heading, `actions` on the right)
 * above the area's content. Uses the full width of the content panel; forms
 * limit their own width.
 *
 * `fill`: the page takes the panel's height and the content is a flex column
 * whose last child can scroll on its own (`min-h-0 flex-1`), e.g. a table with
 * a sticky header and the pagination below it.
 */
export function Page({
  actions,
  children,
  fill = false,
  title,
}: Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  title: string;
}>) {
  return (
    <main className={cn("flex flex-col", fill && "h-full")}>
      <div className="flex min-h-13 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 className="font-heading text-lg font-semibold">{title}</h1>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <div className={cn("flex flex-col gap-4 p-4", fill && "min-h-0 flex-1")}>{children}</div>
    </main>
  );
}

/** Placeholder text for areas that are not implemented yet. */
export function PagePlaceholder({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-muted-foreground">{children}</p>;
}
