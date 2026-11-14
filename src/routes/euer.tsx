import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { m } from "@/paraglide/messages.js";
import { periodYearOptions } from "@/ui/bookings/booking-filter-model";
import { Button } from "@/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { euerSearchYear, euerYearSearch, validateEuerSearch } from "@/ui/euer/euer-model";
import { useEuer } from "@/ui/euer/euer-queries";
import { EuerReport } from "@/ui/euer/euer-view";
import { FormField } from "@/ui/forms/form-field";
import { Page } from "@/ui/layout/page";
import { useTaxYearList } from "@/ui/tax-years/tax-year-queries";

/**
 * The EÜR year view (#26): the year is a search param (`jahr`, default the
 * current calendar year); the calculation is `EuerService.calculate(year)`
 * (#25). Each position links to its bookings in the booking list.
 */
export const Route = createFileRoute("/euer")({
  validateSearch: validateEuerSearch,
  component: EuerPage,
  head: () => ({ meta: [{ title: m.page_title({ page: m.euer_title() }) }] }),
});

function EuerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The current year, fixed while the page is open.
  const [currentYear] = useState(() => new Date().getFullYear());
  const year = euerSearchYear(search, currentYear);
  const taxYears = useTaxYearList();
  const yearOptions = useMemo(
    () => periodYearOptions(taxYears.data?.map((taxYear) => taxYear.year) ?? [], currentYear, year),
    [taxYears.data, currentYear, year],
  );

  return (
    <Page
      title={m.euer_title()}
      actions={
        <FormField id="euer-year" label={m.euer_year_label()} errors={[]} className="w-28">
          {(control) => (
            <Select<string>
              items={yearOptions.map((option) => ({
                value: String(option),
                label: String(option),
              }))}
              value={String(year)}
              onValueChange={(value) => {
                if (value !== null) {
                  void navigate({ search: euerYearSearch(Number(value), currentYear) });
                }
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      }
    >
      <p className="-mt-3 max-w-3xl text-sm text-muted-foreground">{m.euer_description()}</p>
      <EuerYear year={year} />
    </Page>
  );
}

function EuerYear({ year }: Readonly<{ year: number }>) {
  const { data, error, isPending, refetch } = useEuer(year);

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {m.euer_loading()}
      </p>
    );
  }
  // The year comes from a validated param; an invalid result would be a programmer error.
  if (error || !data.ok) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">{m.euer_load_error()}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {m.common_retry()}
        </Button>
      </div>
    );
  }
  const result = data.euer;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        {m.euer_status({
          year: String(result.year),
          status: result.smallBusiness
            ? m.tax_years_status_small_business()
            : m.tax_years_status_regular(),
        })}{" "}
        <Link to="/einstellungen" className="underline underline-offset-4">
          {m.euer_status_change()}
        </Link>
      </p>
      <EuerReport result={result} />
    </div>
  );
}
