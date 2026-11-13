import type { Clock, Repositories, UnitOfWork } from "@/business/repositories";
import type { Database } from "@/persistence/database";
import { createRepositories, createUnitOfWork } from "@/persistence/repositories";

/**
 * What UI and routes get from the composition root: services and business
 * interfaces – never persistence modules (docs/architecture.md).
 *
 * Until the services exist (#14 ff.), the repositories and the unit of work
 * are exposed as business interfaces. Services will be created here from
 * them; UI and routes should then use the services only.
 */
export interface AppServices {
  /** Each call on its own; never use them inside `unitOfWork.run` (deadlock). */
  readonly repositories: Repositories;
  /** Atomic sequences of repository calls (one transaction). */
  readonly unitOfWork: UnitOfWork;
}

const systemClock: Clock = () => new Date();

export function createAppServices(database: Database, clock: Clock = systemClock): AppServices {
  return {
    repositories: createRepositories(database.db, clock),
    unitOfWork: createUnitOfWork(database, clock),
  };
}
