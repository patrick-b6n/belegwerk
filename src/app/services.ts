import {
  type BookingExportService,
  type BookingService,
  createBookingExportService,
  createBookingService,
} from "@/business/bookings";
import { type CategoryService, createCategoryService } from "@/business/categories";
import {
  createEuerExportService,
  createEuerService,
  type EuerExportService,
  type EuerService,
} from "@/business/euer";
import type { FileSaver } from "@/business/files";
import type { Clock } from "@/business/repositories";
import {
  createStripeImportService,
  createStripeSettingsService,
  type StripeClient,
  type StripeImportService,
  type StripeSettingsService,
} from "@/business/stripe";
import { createTaxYearService, type TaxYearService } from "@/business/tax-years";
import type { Database } from "@/persistence/database";
import { createUnitOfWork } from "@/persistence/repositories";

import { createStripeHttpClient } from "./stripe-http-client";
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
  /** CSV export of the EÜR (#27): save dialog and file via `FileSaver`. */
  readonly euerExport: EuerExportService;
  /** Stripe key (masked only), import defaults (#28) and the connection test (#29). */
  readonly stripeSettings: StripeSettingsService;
  /** Stripe import of application fees and fee refunds (#30) and its status for #31. */
  readonly stripeImport: StripeImportService;
  readonly taxYears: TaxYearService;
}

const systemClock: Clock = () => new Date();

export function createAppServices(
  database: Database,
  clock: Clock = systemClock,
  fileSaver: FileSaver = createTauriFileSaver(),
  stripeClient: StripeClient = createStripeHttpClient(),
): AppServices {
  const unitOfWork = createUnitOfWork(database, clock);
  const bookings = createBookingService({ unitOfWork });
  const euer = createEuerService({ unitOfWork });
  return {
    bookings,
    bookingExport: createBookingExportService({ bookings, fileSaver }),
    categories: createCategoryService({ unitOfWork }),
    euer,
    euerExport: createEuerExportService({ euer, fileSaver }),
    stripeSettings: createStripeSettingsService({ unitOfWork, stripeClient }),
    stripeImport: createStripeImportService({ unitOfWork, stripeClient, clock }),
    taxYears: createTaxYearService({ unitOfWork }),
  };
}
