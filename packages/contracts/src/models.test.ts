import { describe, expect, it } from "vitest";

import { runEventSchema } from "./events.ts";
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
    // The 14 codes of §10, in the order the master lists them.
    expect(providerErrorCodeSchema.options).toEqual([
      "invalid_api_key",
      "insufficient_quota",
      "rate_limited",
      "model_not_found",
      "context_too_long",
      "provider_timeout",
      "provider_unavailable",
      "content_filtered",
      "tool_failed",
      "run_timeout",
      "limit_reached",
      "integration_needs_reauth",
      "delivery_failed",
      "unknown",
    ]);
    expect(providerErrorCodeSchema.parse("rate_limited")).toBe("rate_limited");
    expect(providerErrorCodeSchema.safeParse("teapot").success).toBe(false);
  });

  it("is the one source of the run.failed codes, not a copy", () => {
    // The event schema reused to redeclare this list. Every catalogue code must
    // be accepted by run.failed, so the two cannot drift apart unnoticed.
    for (const code of providerErrorCodeSchema.options) {
      const parsed = runEventSchema.safeParse({
        type: "run.failed",
        code,
        message: code,
      });
      expect(parsed.success, `run.failed rejected ${code}`).toBe(true);
    }
  });
});
