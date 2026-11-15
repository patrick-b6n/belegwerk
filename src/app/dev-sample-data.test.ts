import { describe, expect, it, vi } from "vitest";

import { createTestDb } from "@/persistence/__tests__/test-db";

import { seedSampleData } from "./dev-sample-data";
import { createAppServices } from "./services";

const TODAY = new Date("2026-11-15T12:00:00Z");

async function setup() {
  const { database } = await createTestDb();
  return createAppServices(database, () => TODAY);
}

describe("seedSampleData", () => {
  it("fills an empty database with valid bookings up to today", async () => {
    const services = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await seedSampleData(services, TODAY);

    // Every sample booking passes the service's validation.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(result.seeded).toBe(true);
    // More than one page of the list (100 rows by default).
    expect(result.created).toBeGreaterThan(100);

    const all = await services.bookings.list({ pageSize: "all" });
    if (!all.ok) throw new Error("list failed");
    expect(all.total).toBe(result.created);
    expect(all.items.every((booking) => booking.date <= "2026-11-15")).toBe(true);
    expect(new Set(all.items.map((booking) => booking.type))).toEqual(
      new Set(["income", "expense"]),
    );
    expect(all.items.some((booking) => booking.source === "stripe")).toBe(true);
  });

  it("leaves a database with bookings alone", async () => {
    const services = await setup();
    const first = await seedSampleData(services, TODAY);

    const second = await seedSampleData(services, TODAY);

    expect(second).toEqual({ seeded: false, created: 0 });
    const all = await services.bookings.list({ pageSize: "all" });
    expect(all.ok && all.total).toBe(first.created);
  });
});
