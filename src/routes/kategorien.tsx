import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { CategoryList } from "@/ui/categories/category-list";
import { useCategoryList } from "@/ui/categories/category-queries";
import { Button } from "@/ui/components/ui/button";
import { Page } from "@/ui/layout/page";

/**
 * The category management (#19). EÜR line numbers are shown for the current
 * calendar year (`describePosition`; without a mapping only the position's
 * name).
 */
export const Route = createFileRoute("/kategorien")({
  component: CategoriesPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.categories_title() }) }] }),
});

function CategoriesPage() {
  return (
    <Page title={m.categories_title()}>
      <p className="-mt-3 max-w-3xl text-sm text-muted-foreground">{m.categories_description()}</p>
      <Categories />
    </Page>
  );
}

function Categories() {
  const { data, error, isPending, refetch } = useCategoryList();
  // The current year, fixed while the page is open.
  const [year] = useState(() => new Date().getFullYear());

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.categories_loading()}
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.categories_load_error()}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  return <CategoryList categories={data} year={year} />;
}
