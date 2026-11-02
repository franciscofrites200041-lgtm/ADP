import { describe, expect, it } from "vitest";

import {
  modelDescriptorSchema,
  modelListResponseSchema,
  providerErrorCodeSchema,
} from "./models.ts";

const model = {
  id: "gpt-test",
  name: "GPT Test",
  providerId: "openai",
  contextWindow: 128000,
  maxTokens: 4096,
  reasoning: false,
};

describe("model descriptor", () => {
  it("accepts a model with null limits", () => {
    expect(
      modelDescriptorSchema.parse({
        ...model,
        contextWindow: null,
        maxTokens: null,
      }),
    ).toMatchObject({ id: "gpt-test" });
  });

  it("rejects an unknown provider and extra fields", () => {
    expect(
      modelDescriptorSchema.safeParse({ ...model, providerId: "acme" }).success,
    ).toBe(false);
    expect(
      modelDescriptorSchema.safeParse({ ...model, apiKey: "sk-nope" }).success,
    ).toBe(false);
  });

  it("wraps the list", () => {
    expect(
      modelListResponseSchema.parse({ models: [model] }).models,
    ).toHaveLength(1);
  });
});

describe("provider error codes", () => {
  it("covers the §10 catalog and rejects anything else", () => {
    // 12 codes in §10, including the run-level ones the gateway can produce.
    expect(providerErrorCodeSchema.options).toHaveLength(12);
    expect(providerErrorCodeSchema.parse("rate_limited")).toBe("rate_limited");
    expect(providerErrorCodeSchema.safeParse("teapot").success).toBe(false);
  });
});
