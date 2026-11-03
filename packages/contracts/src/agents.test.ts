import { describe, expect, it } from "vitest";

import {
  createAgentRequestSchema,
  duplicateAgentRequestSchema,
  restoreAgentVersionRequestSchema,
  updateAgentRequestSchema,
} from "./agents.ts";

const credentialId = "0190a5f2-0000-7000-8000-000000000001";

const version = {
  instructions: "Atendé consultas y derivá lo que no sepas.",
  providerId: "openai" as const,
  modelId: "gpt-5",
  credentialId,
  params: { temperature: 0.2 },
  tools: ["web_search"],
};

describe("createAgentRequestSchema", () => {
  it("accepts an agent with its first version", () => {
    const input = { name: "Soporte", version };

    expect(createAgentRequestSchema.parse(input)).toEqual(input);
  });

  it("rejects a version without a credential or a model", () => {
    const { credentialId: _omitted, ...withoutCredential } = version;
    expect(
      createAgentRequestSchema.safeParse({
        name: "Soporte",
        version: withoutCredential,
      }).success,
    ).toBe(false);

    expect(
      createAgentRequestSchema.safeParse({
        name: "Soporte",
        version: { ...version, modelId: "" },
      }).success,
    ).toBe(false);
  });

  it("rejects control characters in the name", () => {
    expect(
      createAgentRequestSchema.safeParse({ name: "So\u0000porte", version })
        .success,
    ).toBe(false);
  });
});

describe("updateAgentRequestSchema", () => {
  it("accepts a rename without a new version", () => {
    expect(updateAgentRequestSchema.parse({ name: "Soporte 2" })).toEqual({
      name: "Soporte 2",
    });
  });

  it("accepts clearing the description", () => {
    expect(updateAgentRequestSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });

  it("rejects an empty update", () => {
    expect(updateAgentRequestSchema.parse({})).toEqual({});
  });
});

describe("restore and duplicate", () => {
  it("restores by version id only", () => {
    expect(
      restoreAgentVersionRequestSchema.parse({ versionId: credentialId }),
    ).toEqual({ versionId: credentialId });

    expect(restoreAgentVersionRequestSchema.safeParse({}).success).toBe(false);
  });

  it("duplicates with a new name", () => {
    expect(duplicateAgentRequestSchema.parse({ name: "Copia" })).toEqual({
      name: "Copia",
    });

    expect(duplicateAgentRequestSchema.safeParse({ name: "" }).success).toBe(
      false,
    );
  });
});
