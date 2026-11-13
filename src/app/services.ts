import type { Database } from "@/persistence/database";

/**
 * What UI and routes get from the composition root: services and business
 * interfaces – never persistence modules (docs/architecture.md).
 *
 * Empty until the first repositories exist (#11). They are created in
 * {@link createAppServices} from `database`, the services from them.
 */
export type AppServices = Readonly<Record<never, never>>;

export function createAppServices(_database: Database): AppServices {
  return {};
}
