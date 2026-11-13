import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Page, PagePlaceholder } from "@/ui/layout/page";

export const Route = createFileRoute("/einstellungen")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.settings_title() }) }] }),
});

function SettingsPage() {
  return (
    <Page title={m.settings_title()}>
      <PagePlaceholder>{m.settings_placeholder()}</PagePlaceholder>
    </Page>
  );
}
