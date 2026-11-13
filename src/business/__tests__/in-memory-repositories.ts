import type {
  Booking,
  BookingInput,
  BookingSource,
  Category,
  CategoryChanges,
  CategoryInput,
  TaxYear,
} from "../model";
import {
  type BookingRepository,
  type CategoryRepository,
  type Clock,
  ConstraintViolationError,
  type Repositories,
  type SettingsRepository,
  type TaxYearRepository,
  type UnitOfWork,
} from "../repositories";

/**
 * In-memory fakes of the repository interfaces for business tests (#11).
 *
 * They behave like the Drizzle implementations – the shared contract suite
 * (`repository-contract.ts`) runs against both:
 *
 * - ids count up; ids of committed rows are never reused (`AUTOINCREMENT`),
 *   an id handed out in a rolled-back unit of work is,
 * - unique keys and foreign keys raise {@link ConstraintViolationError},
 * - {@link UnitOfWork.run} rolls back every write if the callback rejects.
 *
 * Not emulated: most of the database's CHECK constraints (amount
 * consistency, date format, enum values) – services validate before
 * writing. Emulated (plain `Error`, like the raw CHECK error): "reduces
 * income" only on expense categories.
 *
 * Stricter than the app: while a unit of work runs, the other repositories
 * and a nested `run` throw instead of waiting – in the app they would wait
 * for the transaction forever (deadlock). This also rejects two *concurrent*
 * units of work, which the app would just serialize; business tests run
 * their operations one after another.
 */
export interface InMemoryDatabase {
  /** Repositories outside a unit of work (each call on its own). */
  readonly repositories: Repositories;
  readonly unitOfWork: UnitOfWork;
}

interface State {
  bookings: Map<number, Booking>;
  categories: Map<number, Category>;
  taxYears: Map<number, TaxYear>;
  settings: Map<string, string>;
  lastBookingId: number;
  lastCategoryId: number;
}

export function createInMemoryDatabase(options: { clock?: Clock } = {}): InMemoryDatabase {
  const clock = options.clock ?? (() => new Date());
  let state: State = {
    bookings: new Map(),
    categories: new Map(),
    taxYears: new Map(),
    settings: new Map(),
    lastBookingId: 0,
    lastCategoryId: 0,
  };
  /** Scope of the running unit of work, if any. */
  let active: object | undefined;

  const guardOutside = () => {
    if (active) {
      throw new Error(
        "Repository used while a unit of work is running – inside UnitOfWork.run use only the repositories passed to the callback (in the app this deadlocks)",
      );
    }
  };

  const outside = createRepositories(() => state, clock, guardOutside);

  return {
    repositories: outside,
    unitOfWork: {
      run: async (fn) => {
        if (active) {
          throw new Error(
            "UnitOfWork.run called while another unit of work is running (nested runs deadlock in the app)",
          );
        }
        const scope = {};
        active = scope;
        const snapshot = copyState(state);
        const guardInside = () => {
          if (active !== scope) {
            throw new Error("Repository of a unit of work used after the unit of work ended");
          }
        };
        try {
          return await fn(createRepositories(() => state, clock, guardInside));
        } catch (error) {
          state = snapshot;
          throw error;
        } finally {
          active = undefined;
        }
      },
    },
  };
}

function copyState(state: State): State {
  // Entries are immutable (replaced on every write), so shallow copies suffice.
  return {
    ...state,
    bookings: new Map(state.bookings),
    categories: new Map(state.categories),
    taxYears: new Map(state.taxYears),
    settings: new Map(state.settings),
  };
}

function createRepositories(state: () => State, clock: Clock, guard: () => void): Repositories {
  /** Runs `fn` after the guard; async so that guard errors reject like DB errors. */
  const op =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    async (...args: A): Promise<Awaited<R>> => {
      guard();
      return await fn(...args);
    };
  return {
    bookings: createBookings(state, clock, op),
    categories: createCategories(state, op),
    taxYears: createTaxYears(state, op),
    settings: createSettings(state, op),
  };
}

type Op = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => Promise<Awaited<R>>;

function createBookings(state: () => State, clock: Clock, op: Op): BookingRepository {
  const check = (input: BookingInput, id?: number) => {
    if (!state().categories.has(input.categoryId)) {
      throw new ConstraintViolationError(
        "foreign_key",
        `Category ${input.categoryId} does not exist`,
      );
    }
    if (input.externalId !== null) {
      for (const booking of state().bookings.values()) {
        if (
          booking.id !== id &&
          booking.source === input.source &&
          booking.externalId === input.externalId
        ) {
          throw new ConstraintViolationError(
            "unique",
            `Booking with source ${input.source} and external ID ${input.externalId} exists`,
          );
        }
      }
    }
  };
  return {
    findById: op((id: number) => copy(state().bookings.get(id))),
    insert: op((input: BookingInput) => {
      check(input);
      const now = clock().toISOString();
      const s = state();
      s.lastBookingId += 1;
      const booking: Booking = {
        ...bookingFields(input),
        id: s.lastBookingId,
        createdAt: now,
        updatedAt: now,
      };
      s.bookings.set(booking.id, booking);
      return { ...booking };
    }),
    update: op((id: number, input: BookingInput) => {
      const existing = state().bookings.get(id);
      if (!existing) return undefined;
      check(input, id);
      const booking: Booking = {
        ...bookingFields(input),
        id,
        createdAt: existing.createdAt,
        updatedAt: clock().toISOString(),
      };
      state().bookings.set(id, booking);
      return { ...booking };
    }),
    delete: op((id: number) => state().bookings.delete(id)),
    findExistingExternalIds: op((source: BookingSource, externalIds: readonly string[]) => {
      const wanted = new Set(externalIds);
      const found = new Set<string>();
      for (const booking of state().bookings.values()) {
        if (
          booking.source === source &&
          booking.externalId !== null &&
          wanted.has(booking.externalId)
        ) {
          found.add(booking.externalId);
        }
      }
      return found;
    }),
    countByCategory: op(
      (categoryId: number) =>
        [...state().bookings.values()].filter((booking) => booking.categoryId === categoryId)
          .length,
    ),
    countByCategories: op(() => {
      const counts = new Map<number, number>();
      for (const { categoryId } of state().bookings.values()) {
        counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
      }
      return counts;
    }),
    countVatRateUsage: op((year: number) => {
      const prefix = `${String(year).padStart(4, "0")}-`;
      const inYear = [...state().bookings.values()].filter((booking) =>
        booking.date.startsWith(prefix),
      );
      const withVatRate = inYear.filter((booking) => booking.vatRate !== null).length;
      return { withVatRate, withoutVatRate: inYear.length - withVatRate };
    }),
    listYears: op(() => {
      const years = new Set<number>();
      for (const { date } of state().bookings.values()) years.add(Number(date.slice(0, 4)));
      return [...years].toSorted((a, b) => a - b);
    }),
    list: op(() =>
      [...state().bookings.values()]
        .toSorted((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
        .map((booking) => ({ ...booking })),
    ),
  };
}

function createCategories(state: () => State, op: Op): CategoryRepository {
  const check = (category: Category) => {
    // CHECK categories_reduces_income_expense_check
    if (category.reducesIncome && category.type !== "expense") {
      throw new Error(
        "CHECK constraint failed: categories_reduces_income_expense_check (only expense categories can reduce income)",
      );
    }
    for (const other of state().categories.values()) {
      if (
        other.id !== category.id &&
        other.type === category.type &&
        other.name === category.name
      ) {
        throw new ConstraintViolationError(
          "unique",
          `Category ${category.type}/${category.name} exists`,
        );
      }
    }
  };
  const replace = (id: number, change: (category: Category) => Category) => {
    const existing = state().categories.get(id);
    if (!existing) return undefined;
    const category = change(existing);
    check(category);
    state().categories.set(id, category);
    return { ...category };
  };
  return {
    list: op(() => [...state().categories.values()].toSorted((a, b) => a.id - b.id).map(copyOf)),
    findById: op((id: number) => copy(state().categories.get(id))),
    insert: op((input: CategoryInput) => {
      const s = state();
      const category: Category = {
        id: s.lastCategoryId + 1,
        name: input.name,
        type: input.type,
        euerPosition: input.euerPosition,
        reducesIncome: input.reducesIncome,
        archived: false,
        isSystem: input.isSystem,
      };
      check(category);
      s.lastCategoryId = category.id;
      s.categories.set(category.id, category);
      return { ...category };
    }),
    update: op((id: number, changes: CategoryChanges) =>
      replace(id, (category) => ({
        ...category,
        ...definedOnly({
          name: changes.name,
          euerPosition: changes.euerPosition,
          reducesIncome: changes.reducesIncome,
        }),
      })),
    ),
    setArchived: op((id: number, archived: boolean) =>
      replace(id, (category) => ({ ...category, archived })),
    ),
    delete: op((id: number) => {
      const s = state();
      if (!s.categories.has(id)) return false;
      if ([...s.bookings.values()].some((booking) => booking.categoryId === id)) {
        throw new ConstraintViolationError("foreign_key", `Category ${id} is used by bookings`);
      }
      return s.categories.delete(id);
    }),
  };
}

function createTaxYears(state: () => State, op: Op): TaxYearRepository {
  return {
    find: op((year: number) => copy(state().taxYears.get(year))),
    list: op(() => [...state().taxYears.values()].toSorted((a, b) => a.year - b.year).map(copyOf)),
    upsert: op((taxYear: TaxYear) => {
      const record = { year: taxYear.year, smallBusiness: taxYear.smallBusiness };
      state().taxYears.set(record.year, record);
      return { ...record };
    }),
  };
}

function createSettings(state: () => State, op: Op): SettingsRepository {
  return {
    get: op((key: string) => state().settings.get(key)),
    set: op((key: string, value: string) => {
      state().settings.set(key, value);
    }),
    delete: op((key: string) => state().settings.delete(key)),
  };
}

/** Only the fields of {@link BookingInput} – like the Drizzle implementation, which maps them one by one. */
function bookingFields(input: BookingInput): BookingInput {
  return {
    date: input.date,
    type: input.type,
    grossCents: input.grossCents,
    vatRate: input.vatRate,
    netCents: input.netCents,
    vatCents: input.vatCents,
    categoryId: input.categoryId,
    description: input.description,
    counterparty: input.counterparty,
    reference: input.reference,
    note: input.note,
    source: input.source,
    externalId: input.externalId,
  };
}

function copy<T extends object>(value: T | undefined): T | undefined {
  return value && { ...value };
}

function copyOf<T extends object>(value: T): T {
  return { ...value };
}

/** Drops keys whose value is `undefined` (like Drizzle's `set`). */
function definedOnly<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
