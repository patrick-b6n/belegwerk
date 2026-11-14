/**
 * EÜR service (#25): loads what {@link calculateEuer} needs for a year in one
 * unit of work – the tax status (no record = regularly taxed, #16), all
 * categories (including archived ones; position and flag as of now, #15) and
 * the year's booking sums per category, type and VAT rate (one aggregate
 * query) – and calculates. Same conventions as the other services
 * (docs/architecture.md): result objects with field codes, programmer errors
 * throw.
 */
import type { UnitOfWork } from "../repositories";
import { isTaxYear } from "../tax-years";
import { calculateEuer, type EuerResult } from "./calculate-euer";

export type CalculateEuerResult =
  | { readonly ok: true; readonly euer: EuerResult }
  | {
      readonly ok: false;
      readonly reason: "invalid";
      /** `invalidYear`: not an integer in 1000–9999 (no database access). */
      readonly errors: readonly [{ readonly field: "year"; readonly code: "invalidYear" }];
    };

export interface EuerService {
  /** The EÜR of `year` (bookings by payment date). */
  calculate(year: number): Promise<CalculateEuerResult>;
}

export interface EuerServiceDependencies {
  readonly unitOfWork: UnitOfWork;
}

export function createEuerService({ unitOfWork }: EuerServiceDependencies): EuerService {
  return {
    calculate: async (year) => {
      if (!isTaxYear(year)) {
        return { ok: false, reason: "invalid", errors: [{ field: "year", code: "invalidYear" }] };
      }
      return unitOfWork.run(async (repos) => {
        const taxYear = await repos.taxYears.find(year);
        const categories = await repos.categories.list();
        const groups = await repos.bookings.sumByCategoryAndVatRate(year);
        const euer = calculateEuer({
          year,
          smallBusiness: taxYear?.smallBusiness ?? false,
          groups,
          categories,
        });
        return { ok: true, euer };
      });
    },
  };
}
