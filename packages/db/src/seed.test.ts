import { describe, expect, it } from "vitest";

import type { DbClient } from "./client.js";
import { type SeedStep, seed, seedSteps } from "./seed.js";

function fakeDb(): DbClient {
  return {} as unknown as DbClient;
}

describe("seed", () => {
  it("registers no steps until WP-21 template data exists", () => {
    expect(seedSteps).toHaveLength(0);
  });

  it("is an idempotent no-op: seeding twice never touches the database", async () => {
    const db = fakeDb();

    await expect(seed(db)).resolves.toBeUndefined();
    await expect(seed(db)).resolves.toBeUndefined();
  });

  it("runs each registered step exactly once per invocation, in order", async () => {
    const calls: string[] = [];
    const steps: SeedStep[] = [
      {
        name: "first",
        run: async () => {
          calls.push("first");
        },
      },
      {
        name: "second",
        run: async () => {
          calls.push("second");
        },
      },
    ];

    await seed(fakeDb(), steps);

    expect(calls).toEqual(["first", "second"]);
  });
});
