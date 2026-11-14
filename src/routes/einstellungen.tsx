import { createFileRoute } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";
import { BackupSection } from "@/ui/backup/backup-section";
import { Page } from "@/ui/layout/page";
import { SettingsSection } from "@/ui/settings/settings-section";
import { StripeSettingsSection } from "@/ui/stripe/stripe-settings-section";
import { TaxYearSettings } from "@/ui/tax-years/tax-year-settings";
import { UpdateSection } from "@/ui/updates/update-section";

/**
 * The settings page: one {@link SettingsSection} per area, each loading its
 * own data: "Steuerjahre" (#20), "Stripe" (#28), "Datensicherung" (#32) and
 * "Updates" (#71).
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
        <StripeSettingsSection />
      </SettingsSection>
      <SettingsSection title={m.backup_title()} description={m.backup_description()}>
        <BackupSection />
      </SettingsSection>
      <SettingsSection title={m.update_title()} description={m.update_description()}>
        <UpdateSection />
      </SettingsSection>
    </Page>
  );
}
