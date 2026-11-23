import { asc, eq } from "drizzle-orm";

import type { TaxYear } from "@/business/model";
import type { TaxYearRepository } from "@/business/repositories";

import type { Db } from "../database";
import { taxYears } from "../schema";

export function createTaxYearRepository(db: Db): TaxYearRepository {
  return {
    find: async (year) => {
      const row = await db.select().from(taxYears).where(eq(taxYears.year, year)).get();
      return row && toTaxYear(row);
    },

    list: async () => {
      const rows = await db.select().from(taxYears).orderBy(asc(taxYears.year));
      return rows.map(toTaxYear);
    },

    upsert: async ({ year, smallBusiness }) => {
      const row = await db
        .insert(taxYears)
        .values({ year, smallBusiness })
        .onConflictDoUpdate({ target: taxYears.year, set: { smallBusiness } })
        .returning()
        .get();
      return toTaxYear(row);
    },
  };
}

function toTaxYear(row: typeof taxYears.$inferSelect): TaxYear {
  return { year: row.year, smallBusiness: row.smallBusiness };
}
