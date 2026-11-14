import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Info, TriangleAlert } from "lucide-react";
import { useId } from "react";

import type { EuerReportLine, EuerResult, EuerWarning } from "@/business/euer";
import { formatCurrency } from "@/business/format";
import { m } from "@/paraglide/messages.js";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";
import { PagePlaceholder } from "@/ui/layout/page";

import {
  type EuerRow,
  type EuerWarningView,
  euerTables,
  euerWarningViews,
  isEmptyEuer,
  profitKind,
} from "./euer-model";
import { euerPositionName } from "./position-name";

const AMOUNT = "text-right tabular-nums whitespace-nowrap";

/** The official label of the year (form data), else the position's display name. */
function lineLabel(line: EuerReportLine): string {
  return line.label ?? euerPositionName(line.position);
}

/**
 * The EÜR of one year (#26): hints, one table each for income and expenses
 * (line, label, amount) with totals, and the result (Gewinn/Verlust). A
 * position's label links to its bookings (`lineSearch`).
 */
export function EuerReport({ result }: Readonly<{ result: EuerResult }>) {
  const year = String(result.year);
  if (isEmptyEuer(result)) {
    // No lines, but possibly warnings (e.g. only unassignable bookings):
    // then there are bookings, just none that count.
    const warnings = euerWarningViews(result);
    return (
      <div className="flex flex-col gap-4">
        {!result.hasLineMapping && <NoMappingHint year={year} />}
        <EuerWarnings warnings={warnings} year={year} />
        <PagePlaceholder>
          {warnings.length === 0 ? m.euer_empty({ year }) : m.euer_empty_with_warnings({ year })}
        </PagePlaceholder>
      </div>
    );
  }
  const tables = euerTables(result);
  return (
    <div className="flex flex-col gap-8">
      {!result.hasLineMapping && <NoMappingHint year={year} />}
      <EuerWarnings warnings={euerWarningViews(result)} year={year} />
      <EuerTable
        title={m.euer_income_title()}
        empty={m.euer_income_empty()}
        rows={tables.income}
        totalLabel={m.euer_income_total()}
        totalCents={result.totals.incomeCents}
      />
      <EuerTable
        title={m.euer_expenses_title()}
        empty={m.euer_expenses_empty()}
        rows={tables.expenses}
        totalLabel={m.euer_expenses_total()}
        totalCents={result.totals.expenseCents}
      />
      <EuerResultSummary result={result} />
    </div>
  );
}

function NoMappingHint({ year }: Readonly<{ year: string }>) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {m.euer_no_mapping({ year })}
    </p>
  );
}

function EuerTable({
  title,
  empty,
  rows,
  totalLabel,
  totalCents,
}: Readonly<{
  title: string;
  empty: string;
  rows: readonly EuerRow[];
  totalLabel: string;
  totalCents: number;
}>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table className="table-fixed">
          <TableCaption className="sr-only">{title}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{m.euer_column_line()}</TableHead>
              <TableHead>{m.euer_column_label()}</TableHead>
              <TableHead className="w-40 text-right">{m.euer_column_amount()}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <EuerTableRow key={row.line.position} row={row} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell />
              <th scope="row" className="p-2 text-left font-semibold">
                {totalLabel}
              </th>
              <TableCell className={cn(AMOUNT, "font-semibold")}>
                {formatCurrency(totalCents)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </section>
  );
}

function EuerTableRow({ row }: Readonly<{ row: EuerRow }>) {
  const { line, informational, search } = row;
  const label = lineLabel(line);
  const count = line.bookingCount;
  const countId = useId();
  const countText =
    count === 1 ? m.euer_line_bookings_one() : m.euer_line_bookings_other({ count: String(count) });
  return (
    <TableRow
      data-position={line.position}
      className={cn(informational && "text-muted-foreground")}
    >
      <TableCell className="align-top tabular-nums">
        {line.line === undefined ? (
          <>
            <span aria-hidden>{m.euer_line_missing()}</span>
            <span className="sr-only">{m.euer_line_missing_label()}</span>
          </>
        ) : (
          line.line
        )}
      </TableCell>
      <TableCell className={cn("align-top whitespace-normal", informational && "pl-6")}>
        <div className="flex items-baseline gap-2">
          {search === undefined ? (
            <span>{label}</span>
          ) : (
            <>
              {/* The count as tooltip and, for screen readers, as description
                  (a hidden element still names it, without being read twice). */}
              <Link
                to="/bookings"
                search={search}
                title={countText}
                aria-describedby={countId}
                className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:decoration-foreground"
              >
                {label}
              </Link>
              <span id={countId} hidden>
                {countText}
              </span>
            </>
          )}
          {informational && (
            <span
              title={m.euer_informational_title()}
              className="shrink-0 rounded-sm bg-muted px-1 text-xs text-muted-foreground"
            >
              {m.euer_informational()}
            </span>
          )}
        </div>
        {line.entertainment && (
          <p className="mt-1 text-xs text-muted-foreground">
            {m.euer_entertainment_columns({
              total: formatCurrency(line.entertainment.totalCents),
              nonDeductible: formatCurrency(line.entertainment.nonDeductibleCents),
              deductible: formatCurrency(line.entertainment.deductibleCents),
            })}
          </p>
        )}
      </TableCell>
      <TableCell className={cn(AMOUNT, "align-top", informational && "italic")}>
        {informational ? `(${formatCurrency(line.amountCents)})` : formatCurrency(line.amountCents)}
      </TableCell>
    </TableRow>
  );
}

/** Totals and Gewinn/Verlust – the result has a sign and a word, not only a colour. */
function EuerResultSummary({ result }: Readonly<{ result: EuerResult }>) {
  const headingId = useId();
  const { incomeCents, expenseCents, profitCents } = result.totals;
  const kind = profitKind(profitCents);
  const resultLabel =
    kind === "profit"
      ? m.euer_result_profit()
      : kind === "loss"
        ? m.euer_result_loss()
        : m.euer_result_zero();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-heading text-lg font-semibold">
        {m.euer_result_title()}
      </h2>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-y-1 rounded-lg border p-4 text-sm">
        <dt>{m.euer_income_total()}</dt>
        <dd className={cn(AMOUNT, "pl-6")}>{formatCurrency(incomeCents)}</dd>
        <dt>{m.euer_expenses_total()}</dt>
        <dd className={cn(AMOUNT, "pl-6")}>{formatCurrency(expenseCents)}</dd>
        <dt data-result={kind} className="border-t pt-1 font-semibold">
          {resultLabel}
        </dt>
        <dd
          className={cn(
            AMOUNT,
            "border-t pt-1 pl-6 font-semibold",
            kind === "profit" && "text-emerald-700 dark:text-emerald-400",
            kind === "loss" && "text-rose-700 dark:text-rose-400",
          )}
        >
          {`${profitCents > 0 ? "+" : ""}${formatCurrency(profitCents)}`}
        </dd>
      </dl>
    </section>
  );
}

function warningText(view: EuerWarningView, year: string): string {
  const warning: EuerWarning = view.warning;
  switch (warning.code) {
    case "vatRateInSmallBusinessYear":
      return m.euer_warning_vat_rate_in_small_business_year({
        count: String(warning.bookingCount),
        year,
      });
    case "vatRateMissingInRegularYear":
      return m.euer_warning_vat_rate_missing_in_regular_year({
        count: String(warning.bookingCount),
        year,
      });
    case "vatRateOnTaxPayment":
      return m.euer_warning_vat_rate_on_tax_payment({ count: String(warning.bookingCount) });
    case "unassignableBookings":
      return m.euer_warning_unassignable_bookings({ count: String(warning.bookingCount) });
    case "negativeLine": {
      const lineNumber = view.line?.line;
      return m.euer_warning_negative_line({
        line:
          lineNumber === undefined
            ? m.euer_warning_negative_line_position({
                position: view.line ? lineLabel(view.line) : euerPositionName(warning.position),
              })
            : m.euer_warning_negative_line_number({ line: String(lineNumber) }),
      });
    }
    case "entertainmentSplit":
      return m.euer_warning_entertainment_split({
        nonDeductible: formatCurrency(view.line?.entertainment?.nonDeductibleCents ?? 0),
      });
    case "mealAllowanceFlatRates":
      return m.euer_warning_meal_allowance_flat_rates();
  }
}

/** Hints of the calculation (#25), each with a link to the bookings concerned where possible. */
function EuerWarnings({
  warnings,
  year,
}: Readonly<{ warnings: readonly EuerWarningView[]; year: string }>) {
  const headingId = useId();
  if (warnings.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40"
    >
      <h2 id={headingId} className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden className="size-4" />
        {m.euer_warnings_title()}
      </h2>
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {warnings.map((view, index) => (
          <li key={`${view.warning.code}-${index}`} data-warning={view.warning.code}>
            {warningText(view, year)}{" "}
            {view.search && (
              <Link
                to="/bookings"
                search={view.search}
                className="font-medium whitespace-nowrap underline underline-offset-4"
              >
                {m.euer_warning_show_bookings()}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
