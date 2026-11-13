/**
 * Tax year service (#16): reads and sets the tax status (Kleinunternehmer,
 * §19 UStG, yes/no) per calendar year. A year without a record is regularly
 * taxed. Same conventions as the booking (#14) and category (#15) services
 * (docs/architecture.md): one {@link UnitOfWork.run} per operation, result
 * objects with field-addressable codes, programmer errors throw.
 *
 * **Changing the status of a year with bookings.** The booking rule
 * (`calculateBookingAmounts`) depends on the year: small business years
 * record no VAT rate, regularly taxed years require one. Switching a year
 * makes its existing bookings with (→ small business) or without
 * (→ regular) a rate *mismatched*. Such a change is refused with
 * `reason: "conflicts"` and the number of mismatched bookings, unless the
 * caller acknowledges it (`acknowledgeConflicts: true`, after the UI has
 * asked the user). Bookings are never rewritten: which rate a booking
 * should get when a year becomes regularly taxed cannot be derived. A
 * mismatched booking stays loadable and deletable; saving it again through
 * the booking service requires a rate that fits the year's (new) status.
 *
 * Blocking without an override would be a dead end: a mismatched booking
 * cannot be edited into the target state while the year still has the old
 * status (the booking service validates against the current status), so
 * the user could only delete and re-enter all bookings of the year.
 */
import type { TaxYear } from "../model";
import type { Repositories, UnitOfWork, VatRateUsage } from "../repositories";

/** Supported years, the same range as booking dates and the `tax_years` CHECK. */
export const TAX_YEAR_MIN = 1000;
export const TAX_YEAR_MAX = 9999;

/** The tax status of a year. */
export interface TaxYearStatus extends TaxYear {
  /** `true` if a record exists; `false` = default (regularly taxed). */
  readonly explicit: boolean;
}

/** A year of {@link TaxYearService.list}: its status plus the bookings that do not fit it. */
export interface TaxYearOverview extends TaxYearStatus {
  /**
   * Bookings of the year whose VAT rate does not fit its status (with a rate
   * in a small business year, without one in a regularly taxed year), e.g.
   * after an acknowledged status change. They need a fitting rate on their
   * next edit; the settings page (#20) shows a hint.
   */
  readonly mismatchedBookings: number;
}

/** Error codes per field. At most one error is reported per field. */
export interface TaxYearFieldErrorCodes {
  /**
   * `invalidYear`: not an integer in 1000–9999; `yearExists`: `addYear` for
   * a year that already has a record.
   */
  readonly year: "invalidYear" | "yearExists";
  /** `invalidValue`: not a boolean (checked at runtime). */
  readonly smallBusiness: "invalidValue";
}

export type TaxYearField = keyof TaxYearFieldErrorCodes;

export type TaxYearErrorCode = TaxYearFieldErrorCodes[TaxYearField];

export type TaxYearFieldError = {
  readonly [F in TaxYearField]: { readonly field: F; readonly code: TaxYearFieldErrorCodes[F] };
}[TaxYearField];

export type TaxYearInvalid = {
  readonly ok: false;
  readonly reason: "invalid";
  /** All field errors (at most one per field), in the order year, smallBusiness. */
  readonly errors: readonly TaxYearFieldError[];
};

/**
 * The change would leave bookings of the year with a mismatched VAT rate:
 * with a rate when switching to small business, without one when switching
 * to regular taxation. Nothing was written; repeat with
 * `acknowledgeConflicts: true` to change the status anyway.
 */
export type TaxYearConflicts = {
  readonly ok: false;
  readonly reason: "conflicts";
  /** Bookings of the year whose VAT rate would not fit the new status (> 0). */
  readonly mismatchedBookings: number;
};

export type GetTaxYearResult =
  | { readonly ok: true; readonly taxYear: TaxYearStatus }
  | TaxYearInvalid;

export type AddTaxYearResult =
  | { readonly ok: true; readonly taxYear: TaxYearStatus }
  | TaxYearInvalid;

export type SetSmallBusinessResult =
  | {
      readonly ok: true;
      readonly taxYear: TaxYearStatus;
      /**
       * Bookings of the year whose VAT rate does not fit the status now
       * (after an acknowledged change, or left over from an earlier one);
       * they need a fitting rate on their next edit.
       */
      readonly mismatchedBookings: number;
    }
  | TaxYearInvalid
  | TaxYearConflicts;

export interface SetSmallBusinessOptions {
  /** Change the status even if bookings of the year then mismatch (only `true` counts). */
  readonly acknowledgeConflicts?: boolean;
}

export interface TaxYearService {
  /** The status of `year`; without a record regularly taxed (`explicit: false`). */
  get(year: number): Promise<GetTaxYearResult>;
  /**
   * All years that have a record or bookings, ascending – years with
   * bookings but no record appear with the default (`explicit: false`) –
   * each with its number of mismatched bookings.
   */
  list(): Promise<TaxYearOverview[]>;
  /**
   * Records `year` as regularly taxed ("Jahr hinzufügen", #20), e.g. to set
   * the status before the first booking. `yearExists` if it has a record.
   */
  addYear(year: number): Promise<AddTaxYearResult>;
  /**
   * Sets the status of `year` (creates the record if needed). A change that
   * leaves bookings mismatched needs `acknowledgeConflicts`, see the module
   * comment. Setting the current status again always succeeds (and records
   * the year).
   */
  setSmallBusiness(
    year: number,
    smallBusiness: boolean,
    options?: SetSmallBusinessOptions,
  ): Promise<SetSmallBusinessResult>;
}

export interface TaxYearServiceDependencies {
  readonly unitOfWork: UnitOfWork;
}

export function createTaxYearService({ unitOfWork }: TaxYearServiceDependencies): TaxYearService {
  return {
    get: async (year) => {
      if (!isTaxYear(year)) return invalidYear();
      return unitOfWork.run(async (repos) => ({ ok: true, taxYear: await status(repos, year) }));
    },

    list: () =>
      unitOfWork.run(async (repos) => {
        const records = await repos.taxYears.list();
        const bookingYears = await repos.bookings.listYears();
        const byYear = new Map<number, TaxYearStatus>(
          bookingYears.map((year) => [year, { year, smallBusiness: false, explicit: false }]),
        );
        for (const record of records) byYear.set(record.year, explicitStatus(record));
        const withBookings = new Set(bookingYears);
        const overviews: TaxYearOverview[] = [];
        for (const taxYear of byYear.values()) {
          // One count per year with bookings; years without bookings have none.
          const mismatchedBookings = withBookings.has(taxYear.year)
            ? mismatched(
                await repos.bookings.countVatRateUsage(taxYear.year),
                taxYear.smallBusiness,
              )
            : 0;
          overviews.push({ ...taxYear, mismatchedBookings });
        }
        overviews.sort((a, b) => a.year - b.year);
        return overviews;
      }),

    addYear: async (year) => {
      if (!isTaxYear(year)) return invalidYear();
      return unitOfWork.run(async (repos) => {
        if (await repos.taxYears.find(year)) {
          return invalid([{ field: "year", code: "yearExists" }]);
        }
        const record = await repos.taxYears.upsert({ year, smallBusiness: false });
        return { ok: true, taxYear: explicitStatus(record) };
      });
    },

    setSmallBusiness: async (year, smallBusiness, options) => {
      const errors: TaxYearFieldError[] = [];
      if (!isTaxYear(year)) errors.push({ field: "year", code: "invalidYear" });
      if (typeof smallBusiness !== "boolean") {
        errors.push({ field: "smallBusiness", code: "invalidValue" });
      }
      if (errors.length > 0) return invalid(errors);
      const acknowledged = options?.acknowledgeConflicts === true;

      return unitOfWork.run(async (repos): Promise<SetSmallBusinessResult> => {
        const current = await status(repos, year);
        const usage = await repos.bookings.countVatRateUsage(year);
        const mismatchedBookings = mismatched(usage, smallBusiness);
        const changed = current.smallBusiness !== smallBusiness;
        if (changed && mismatchedBookings > 0 && !acknowledged) {
          return { ok: false, reason: "conflicts", mismatchedBookings };
        }
        const record = await repos.taxYears.upsert({ year, smallBusiness });
        return { ok: true, taxYear: explicitStatus(record), mismatchedBookings };
      });
    },
  };
}

/** Safe integer in {@link TAX_YEAR_MIN}–{@link TAX_YEAR_MAX} (e.g. not `NaN` from an empty input). */
export function isTaxYear(value: number): boolean {
  return Number.isSafeInteger(value) && value >= TAX_YEAR_MIN && value <= TAX_YEAR_MAX;
}

async function status(repos: Repositories, year: number): Promise<TaxYearStatus> {
  const record = await repos.taxYears.find(year);
  return record ? explicitStatus(record) : { year, smallBusiness: false, explicit: false };
}

function explicitStatus(record: TaxYear): TaxYearStatus {
  return { year: record.year, smallBusiness: record.smallBusiness, explicit: true };
}

/** Bookings whose VAT rate does not fit `smallBusiness` (see the module comment). */
function mismatched(usage: VatRateUsage, smallBusiness: boolean): number {
  return smallBusiness ? usage.withVatRate : usage.withoutVatRate;
}

function invalid(errors: readonly TaxYearFieldError[]): TaxYearInvalid {
  return { ok: false, reason: "invalid", errors };
}

/** A fresh result per call, so callers cannot share (and mutate) one object. */
function invalidYear(): TaxYearInvalid {
  return invalid([{ field: "year", code: "invalidYear" }]);
}
