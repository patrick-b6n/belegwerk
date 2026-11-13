import type { ReactNode } from "react";

/** Content frame of an area: heading plus the area's content. */
export function Page({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

/** Placeholder text for areas that are not implemented yet. */
export function PagePlaceholder({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-muted-foreground">{children}</p>;
}
