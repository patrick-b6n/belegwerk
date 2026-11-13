/**
 * Domain types (#11). Business works only with these; src/persistence maps
 * its rows to and from them (docs/architecture.md).
 *
 * Conventions: dates are ISO calendar dates `YYYY-MM-DD`, amounts integer
 * euro cents (always positive, #1), timestamps `Date#toISOString()` strings
 * (UTC).
 */

export type BookingType = "income" | "expense";

/**
 * VAT rate of a booking. `"reverse_charge"` is its own value; a booking
 * without a recorded rate (small business, §19 UStG) has `vatRate: null`.
 */
export type VatRate = "0" | "7" | "19" | "reverse_charge";

/** Where a booking came from – informational only (#1). */
export type BookingSource = "manual" | "stripe";

export interface Booking {
  readonly id: number;
  /** Payment date `YYYY-MM-DD`; its year is the EÜR year. */
  readonly date: string;
  readonly type: BookingType;
  readonly grossCents: number;
  /** `null` = no rate recorded (small business). */
  readonly vatRate: VatRate | null;
  readonly netCents: number;
  readonly vatCents: number;
  readonly categoryId: number;
  readonly description: string;
  readonly counterparty: string;
  readonly reference: string | null;
  readonly note: string | null;
  readonly source: BookingSource;
  /** ID in the source system (e.g. Stripe `fee_…`); duplicate detection only. */
  readonly externalId: string | null;
  /** Set by the repository (clock); `toISOString()` format. */
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** All fields of a booking the caller decides (insert and full update). */
export type BookingInput = Omit<Booking, "id" | "createdAt" | "updatedAt">;

export interface Category {
  readonly id: number;
  readonly name: string;
  readonly type: BookingType;
  /** Stable EÜR position key (#13), e.g. `BETRIEBSEINNAHMEN_UST_PFLICHTIG`. */
  readonly euerPosition: string;
  /** Erlösminderung: reduces income instead of counting as an expense. */
  readonly reducesIncome: boolean;
  readonly archived: boolean;
  /** Predefined category (#13). */
  readonly isSystem: boolean;
}

/** A new category; it starts unarchived. */
export type CategoryInput = Omit<Category, "id" | "archived">;

/** Editable fields of a category. The type is fixed once bookings may use it. */
export type CategoryChanges = Partial<Pick<Category, "name" | "euerPosition" | "reducesIncome">>;

/** Tax status of a calendar year. A year without a record is regularly taxed (#16). */
export interface TaxYear {
  readonly year: number;
  /** Kleinunternehmer (§19 UStG): no VAT rate is recorded. */
  readonly smallBusiness: boolean;
}
