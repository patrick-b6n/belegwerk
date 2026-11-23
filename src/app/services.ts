import { type BackupService, createBackupService, type DatabaseBackup } from "@/business/backup";
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
import type { FileSaver, SavePathPicker } from "@/business/files";
import type { Clock } from "@/business/repositories";
import {
  createStripeImportService,
  createStripeSettingsService,
  type StripeClient,
  type StripeImportService,
  type StripeSettingsService,
} from "@/business/stripe";
import { createTaxYearService, type TaxYearService } from "@/business/tax-years";
import { createUpdateService, type Updater, type UpdateService } from "@/business/updates";
import type { Database } from "@/persistence/database";
import { createUnitOfWork } from "@/persistence/repositories";

import { createStripeHttpClient } from "./stripe-http-client";
import { createTauriDatabaseBackup } from "./tauri-database-backup";
import { createTauriFileSaver, createTauriSavePathPicker } from "./tauri-file-saver";
import { createTauriUpdater } from "./tauri-updater";

/**
 * What UI and routes get from the composition root: services only – never
 * repositories or persistence modules (docs/architecture.md). Every service
 * runs its reads and writes in its own unit of work.
 */
export interface AppServices {
  readonly backup: BackupService;
  readonly bookings: BookingService;
  readonly bookingExport: BookingExportService;
  readonly categories: CategoryService;
  readonly euer: EuerService;
  readonly euerExport: EuerExportService;
  readonly stripeSettings: StripeSettingsService;
  readonly stripeImport: StripeImportService;
  readonly taxYears: TaxYearService;
  readonly updates: UpdateService;
}

const systemClock: Clock = () => new Date();

export function createAppServices(
  database: Database,
  clock: Clock = systemClock,
  fileSaver: FileSaver = createTauriFileSaver(),
  stripeClient: StripeClient = createStripeHttpClient(),
  savePathPicker: SavePathPicker = createTauriSavePathPicker(),
  databaseBackup: DatabaseBackup = createTauriDatabaseBackup(database),
  updater: Updater = createTauriUpdater(),
): AppServices {
  const unitOfWork = createUnitOfWork(database, clock);
  const bookings = createBookingService({ unitOfWork });
  const euer = createEuerService({ unitOfWork });
  return {
    backup: createBackupService({ savePathPicker, databaseBackup, clock }),
    bookings,
    bookingExport: createBookingExportService({ bookings, fileSaver }),
    categories: createCategoryService({ unitOfWork }),
    euer,
    euerExport: createEuerExportService({ euer, fileSaver }),
    stripeSettings: createStripeSettingsService({ unitOfWork, stripeClient }),
    stripeImport: createStripeImportService({ unitOfWork, stripeClient, clock }),
    taxYears: createTaxYearService({ unitOfWork }),
    updates: createUpdateService({ updater }),
  };
}
