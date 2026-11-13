import { describe, expect, it } from "vitest";

import { createInMemoryDatabase } from "./in-memory-repositories";
import { describeRepositoryContract } from "./repository-contract";

describeRepositoryContract("in-memory fakes", async (clock) => createInMemoryDatabase({ clock }));

describe("in-memory unit of work", () => {
  it("rejects outer repositories while a unit of work runs (deadlock in the app)", async () => {
    const { repositories, unitOfWork } = createInMemoryDatabase();
    await expect(unitOfWork.run(async () => repositories.settings.get("key"))).rejects.toThrow(
      /inside UnitOfWork\.run use only the repositories passed/,
    );
  });

  it("rejects a nested unit of work", async () => {
    const { unitOfWork } = createInMemoryDatabase();
    await expect(unitOfWork.run(async () => unitOfWork.run(async () => undefined))).rejects.toThrow(
      /nested runs deadlock/,
    );
  });

  it("rejects repositories of a finished unit of work", async () => {
    const { repositories, unitOfWork } = createInMemoryDatabase();
    const leaked = await unitOfWork.run(async (tx) => tx);
    await expect(leaked.settings.get("key")).rejects.toThrow(/after the unit of work ended/);
    // The outer repositories work again.
    await expect(repositories.settings.get("key")).resolves.toBeUndefined();
  });

  it("returns copies that cannot change the stored data", async () => {
    const { repositories } = createInMemoryDatabase();
    const category = await repositories.categories.insert({
      name: "A",
      type: "income",
      euerPosition: "X",
      reducesIncome: false,
      isSystem: false,
    });
    (category as { name: string }).name = "B";
    expect((await repositories.categories.findById(category.id))?.name).toBe("A");
  });
});
