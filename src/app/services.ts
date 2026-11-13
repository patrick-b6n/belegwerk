import { type BookingService, createBookingService } from "@/business/bookings";
import { type CategoryService, createCategoryService } from "@/business/categories";
import type { Clock } from "@/business/repositories";
import { createTaxYearService, type TaxYearService } from "@/business/tax-years";
import type { Database } from "@/persistence/database";
import { createUnitOfWork } from "@/persistence/repositories";

/**
 * What UI and routes get from the composition root: services only – never
 * repositories or persistence modules (docs/architecture.md). Every service
 * runs its reads and writes in its own unit of work.
 */
export interface AppServices {
  readonly bookings: BookingService;
  readonly categories: CategoryService;
  readonly taxYears: TaxYearService;
}

const systemClock: Clock = () => new Date();

export function createAppServices(database: Database, clock: Clock = systemClock): AppServices {
  const unitOfWork = createUnitOfWork(database, clock);
  return {
    bookings: createBookingService({ unitOfWork }),
    categories: createCategoryService({ unitOfWork }),
    taxYears: createTaxYearService({ unitOfWork }),
  };
}
