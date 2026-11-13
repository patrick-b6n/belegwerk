/**
 * Repository interfaces (ports, #11): thin data access without business
 * rules. Validation (required fields, amounts, category type, archived
 * categories, tax status) belongs to the services (#14 ff.), which run
 * against these interfaces. src/persistence implements them with Drizzle,
 * business tests use the in-memory fakes in `__tests__/`.
 *
 * Rules for callers (docs/architecture.md, "Repositories und Unit of Work"):
 *
 * - Several writes that belong together run in {@link UnitOfWork.run} and use
 *   **only** the repositories passed to the callback. Using other
 *   repositories (or a nested `run`) inside the callback waits for the
 *   running transaction and deadlocks the app.
 * - Constraint violations surface as {@link ConstraintViolationError}.
 *   Services check the conditions beforehand to produce good messages; the
 *   error is the safety net (and covers races).
 */
import type {
  Booking,
  BookingInput,
  BookingSource,
  Category,
  CategoryChanges,
  CategoryInput,
  TaxYear,
} from "./model";

export interface BookingRepository {
  findById(id: number): Promise<Booking | undefined>;
  /** Sets `createdAt`/`updatedAt` from the clock. */
  insert(input: BookingInput): Promise<Booking>;
  /** Replaces all fields of the booking; sets `updatedAt`. `undefined` if it does not exist. */
  update(id: number, input: BookingInput): Promise<Booking | undefined>;
  /** `false` if it did not exist. */
  delete(id: number): Promise<boolean>;
  /**
   * Which of `externalIds` already exist for `source` (duplicate protection
   * of the Stripe import, #30). Any number of IDs.
   */
  findExistingExternalIds(
    source: BookingSource,
    externalIds: readonly string[],
  ): Promise<Set<string>>;
  /** Number of bookings using the category (archive or delete, #15). */
  countByCategory(categoryId: number): Promise<number>;
  /**
   * Number of bookings per category id in one query (category list, #15).
   * Categories without bookings are missing from the map.
   */
  countByCategories(): Promise<Map<number, number>>;
  /**
   * Bookings dated in `year`, split by whether a VAT rate is recorded – to
   * decide about changing the year's tax status (#16).
   */
  countVatRateUsage(year: number): Promise<VatRateUsage>;
  /** Distinct years of the booking dates, ascending (tax year list, #16/#20). */
  listYears(): Promise<number[]>;
  // Search, filter, sort, pagination and sums follow with #21 as a separate
  // method taking a query object (`search(query)`).
}

export interface VatRateUsage {
  readonly withVatRate: number;
  readonly withoutVatRate: number;
}

export interface CategoryRepository {
  /** All categories including archived ones, ordered by id. */
  list(): Promise<Category[]>;
  findById(id: number): Promise<Category | undefined>;
  /**
   * New categories are not archived. Unique per `(type, name)`.
   * `reducesIncome` is only allowed for expense categories – the service
   * validates it; the database rejects it with a raw CHECK error (no
   * {@link ConstraintViolationError}). Same for `update`.
   */
  insert(input: CategoryInput): Promise<Category>;
  /** `undefined` if it does not exist. */
  update(id: number, changes: CategoryChanges): Promise<Category | undefined>;
  /** Archives or reactivates; `undefined` if it does not exist. */
  setArchived(id: number, archived: boolean): Promise<Category | undefined>;
  /**
   * `false` if it did not exist. Fails with a `"foreign_key"`
   * {@link ConstraintViolationError} while bookings use it.
   */
  delete(id: number): Promise<boolean>;
}

export interface TaxYearRepository {
  /** `undefined` if the year has no record (= regularly taxed, #16). */
  find(year: number): Promise<TaxYear | undefined>;
  /** All recorded years, ascending. */
  list(): Promise<TaxYear[]>;
  /** Creates or replaces the record of `taxYear.year`. */
  upsert(taxYear: TaxYear): Promise<TaxYear>;
}

/** Key-value settings (e.g. Stripe key, last import, defaults – #29 ff.). */
export interface SettingsRepository {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  /** `false` if the key did not exist. */
  delete(key: string): Promise<boolean>;
}

export interface Repositories {
  readonly bookings: BookingRepository;
  readonly categories: CategoryRepository;
  readonly taxYears: TaxYearRepository;
  readonly settings: SettingsRepository;
}

/**
 * Runs several repository operations atomically (one database transaction).
 *
 * Inside `fn` use only the `repos` passed to it – never other repositories
 * and no nested `run`: in the app those wait for the transaction to end,
 * which never happens (deadlock). The in-memory fake rejects such calls.
 */
export interface UnitOfWork {
  /** Commits if `fn` resolves; rolls back and rethrows if it rejects. */
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

/** Current time; injected so tests can use a fixed clock. */
export type Clock = () => Date;

export type ConstraintKind =
  /** A unique key already exists (category `(type, name)`, booking `(source, externalId)`, …). */
  | "unique"
  /** A referenced row is missing, or a row is still referenced (category with bookings). */
  | "foreign_key";

/** A write violated a database constraint the services did not (or could not) check before. */
export class ConstraintViolationError extends Error {
  readonly kind: ConstraintKind;

  constructor(kind: ConstraintKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConstraintViolationError";
    this.kind = kind;
  }
}
