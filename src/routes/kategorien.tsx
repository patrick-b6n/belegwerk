import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Page, PagePlaceholder } from "@/ui/layout/page";

export const Route = createFileRoute("/kategorien")({
  component: CategoriesPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.categories_title() }) }] }),
});

function CategoriesPage() {
  return (
    <Page title={m.categories_title()}>
      <PagePlaceholder>{m.categories_placeholder()}</PagePlaceholder>
    </Page>
  );
}
