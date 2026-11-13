import { eq } from "drizzle-orm";

import type { SettingsRepository } from "@/business/repositories";

import type { Db } from "../database";
import { settings } from "../schema";

/** Drizzle implementation of {@link SettingsRepository} on `db` (or a transaction's `tx`). */
export function createSettingsRepository(db: Db): SettingsRepository {
  return {
    get: async (key) => {
      const row = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .get();
      return row?.value;
    },

    set: async (key, value) => {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    },

    delete: async (key) => {
      const rows = await db
        .delete(settings)
        .where(eq(settings.key, key))
        .returning({ key: settings.key });
      return rows.length > 0;
    },
  };
}
