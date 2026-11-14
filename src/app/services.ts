import {
  type BookingExportService,
  type BookingService,
  createBookingExportService,
  createBookingService,
} from "@/business/bookings";
import { type CategoryService, createCategoryService } from "@/business/categories";
import { createEuerService, type EuerService } from "@/business/euer";
import type { FileSaver } from "@/business/files";
import type { Clock } from "@/business/repositories";
import { createTaxYearService, type TaxYearService } from "@/business/tax-years";
import type { Database } from "@/persistence/database";
import { createUnitOfWork } from "@/persistence/repositories";

import { createTauriFileSaver } from "./tauri-file-saver";

/**
 * What UI and routes get from the composition root: services only – never
 * repositories or persistence modules (docs/architecture.md). Every service
 * runs its reads and writes in its own unit of work.
 */
export interface AppServices {
  readonly bookings: BookingService;
  /** CSV export of the booking list (#24): save dialog and file via `FileSaver`. */
  readonly bookingExport: BookingExportService;
  readonly categories: CategoryService;
  /** EÜR of a year (#25). */
  readonly euer: EuerService;
  readonly taxYears: TaxYearService;
}

const systemClock: Clock = () => new Date();

export function createAppServices(
  database: Database,
  clock: Clock = systemClock,
  fileSaver: FileSaver = createTauriFileSaver(),
): AppServices {
  const unitOfWork = createUnitOfWork(database, clock);
  const bookings = createBookingService({ unitOfWork });
  return {
    bookings,
    bookingExport: createBookingExportService({ bookings, fileSaver }),
    categories: createCategoryService({ unitOfWork }),
    euer: createEuerService({ unitOfWork }),
    taxYears: createTaxYearService({ unitOfWork }),
  };
}
