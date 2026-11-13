import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Page, PagePlaceholder } from "@/ui/layout/page";

export const Route = createFileRoute("/euer")({
  component: EuerPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.euer_title() }) }] }),
});

function EuerPage() {
  return (
    <Page title={m.euer_title()}>
      <PagePlaceholder>{m.euer_placeholder()}</PagePlaceholder>
    </Page>
  );
}
