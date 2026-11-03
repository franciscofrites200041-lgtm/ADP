import { describe, expect, it } from "vitest";

import type { DbClient } from "./client.ts";
import { type SeedStep, seed, seedSteps } from "./seed.ts";
import { agentTemplateSeedData } from "./seed-agent-templates.ts";

function fakeDb(): DbClient {
  return {} as unknown as DbClient;
}

describe("seed", () => {
  it("registers the six agent templates of WP-21", () => {
    expect(seedSteps.map((step) => step.name)).toEqual(["agent-templates"]);
    // The master names exactly these six; the seed carries them verbatim.
    expect(agentTemplateSeedData).toHaveLength(6);
  });

  it("gives every template a stable id, which is what makes the seed idempotent", () => {
    const ids = agentTemplateSeedData.map((template) => template.id);

    expect(new Set(ids).size).toBe(ids.length);
    // A re-run conflicts on the primary key instead of inserting a second copy.
    expect(ids).toEqual(
      expect.arrayContaining(["0190a5f2-0000-7000-8000-0000000a0001"]),
    );
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
