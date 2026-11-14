import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { Page } from "@/ui/layout/page";
import { SettingsSection } from "@/ui/settings/settings-section";
import { StripeSettings } from "@/ui/stripe/stripe-settings";
import { TaxYearSettings } from "@/ui/tax-years/tax-year-settings";

/**
 * The settings page: one {@link SettingsSection} per area, each loading its
 * own data: "Steuerjahre" (#20) and "Stripe" (#28).
 */
export const Route = createFileRoute("/einstellungen")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.settings_title() }) }] }),
});

function SettingsPage() {
  return (
    <Page title={m.settings_title()}>
      <SettingsSection title={m.tax_years_title()} description={m.tax_years_description()}>
        <TaxYearSettings />
      </SettingsSection>
      <SettingsSection title={m.stripe_title()} description={m.stripe_description()}>
        <StripeSettings />
      </SettingsSection>
    </Page>
  );
}
