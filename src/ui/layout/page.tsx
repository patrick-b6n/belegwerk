import { cn } from "cn";
import type { ReactNode } from "react";

import { m } from "@/paraglide/messages.js";
import { Button } from "@/ui/components/ui/button";

/**
 * Content of an area. Like a Windows 11 app with top navigation, a main area
 * shows no visible page title (the active navigation item says where you
 * are); the `title` is the page's `h1` for screen readers. `actions` sit
 * right-aligned above the content. Uses the full width of the content panel;
 * forms limit their own width ({@link PageColumn}).
 *
 * `back`: a page below a main area (e.g. a form) shows its title, with this
 * link back to the area in front of it.
 *
 * `fill`: the page takes the panel's height and the content is a flex column
 * whose last child can scroll on its own (`min-h-0 flex-1`), e.g. a table with
 * a sticky header and the pagination below it.
 *
 * `stretch`: the page is at least as high as the panel and its content grows
 * to fill it, e.g. so a form's command bar sits at the bottom of the window.
 */
export function Page({
  actions,
  back,
  children,
  fill = false,
  stretch = false,
  title,
}: Readonly<{
  actions?: ReactNode;
  back?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  stretch?: boolean;
  title: string;
}>) {
  return (
    <main className={cn("flex flex-col gap-4 p-4", fill && "h-full", stretch && "min-h-full")}>
      {back ? (
        <PageColumn className="flex items-center gap-2">
          {back}
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
        </PageColumn>
      ) : (
        <h1 className="sr-only">{title}</h1>
      )}
      {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
      {children}
    </main>
  );
}

/** The centred column of a form page. */
export function PageColumn({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={cn("mx-auto w-full max-w-3xl", className)}>{children}</div>;
}

/** Heading of a section of a page. */
export function SectionHeading({ id, children }: Readonly<{ id: string; children: ReactNode }>) {
  return (
    <h2 id={id} className="font-heading text-xl font-semibold">
      {children}
    </h2>
  );
}

/** Nothing to show: says so and, if possible, offers the next step. */
export function EmptyState({
  action,
  children,
}: Readonly<{ action?: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center">
      <p className="text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** Shown while a page or section loads its data. */
export function LoadingText({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p role="status" className="text-muted-foreground">
      {children}
    </p>
  );
}

/** Loading failed: the message and "Erneut versuchen". */
export function LoadError({
  children,
  onRetry,
}: Readonly<{ children: ReactNode; onRetry: () => void }>) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="alert">{children}</p>
      <Button variant="outline" onClick={onRetry}>
        {m.common_retry()}
      </Button>
    </div>
  );
}
