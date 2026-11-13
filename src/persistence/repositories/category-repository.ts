import { asc, eq } from "drizzle-orm";

import type { Category } from "@/business/model";
import type { CategoryRepository } from "@/business/repositories";

import type { Db } from "../database";
import { categories } from "../schema";
import { mapConstraintErrors } from "./constraint-errors";

/** Drizzle implementation of {@link CategoryRepository} on `db` (or a transaction's `tx`). */
export function createCategoryRepository(db: Db): CategoryRepository {
  const findById = async (id: number) => {
    const row = await db.select().from(categories).where(eq(categories.id, id)).get();
    return row && toCategory(row);
  };

  const updateColumns = async (id: number, set: Partial<typeof categories.$inferInsert>) => {
    const row = await mapConstraintErrors(() =>
      db.update(categories).set(set).where(eq(categories.id, id)).returning().get(),
    );
    return row && toCategory(row);
  };

  return {
    list: async () => {
      const rows = await db.select().from(categories).orderBy(asc(categories.id));
      return rows.map(toCategory);
    },

    findById,

    insert: async (input) => {
      const row = await mapConstraintErrors(() =>
        db
          .insert(categories)
          .values({
            name: input.name,
            type: input.type,
            euerPosition: input.euerPosition,
            reducesIncome: input.reducesIncome,
            archived: false,
            isSystem: input.isSystem,
          })
          .returning()
          .get(),
      );
      return toCategory(row);
    },

    update: async (id, changes) => {
      const set = {
        name: changes.name,
        euerPosition: changes.euerPosition,
        reducesIncome: changes.reducesIncome,
      };
      // Drizzle skips `undefined` values and rejects an empty SET.
      if (Object.values(set).every((value) => value === undefined)) {
        return findById(id);
      }
      return updateColumns(id, set);
    },

    setArchived: (id, archived) => updateColumns(id, { archived }),

    delete: async (id) => {
      const rows = await mapConstraintErrors(() =>
        db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id }),
      );
      return rows.length > 0;
    },
  };
}

function toCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    euerPosition: row.euerPosition,
    reducesIncome: row.reducesIncome,
    archived: row.archived,
    isSystem: row.isSystem,
  };
}
