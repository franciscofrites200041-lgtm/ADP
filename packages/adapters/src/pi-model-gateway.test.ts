import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  ModelGateway,
  ModelTarget,
  ProviderStreamEvent,
} from "@middleware/core";
import { ProviderError } from "@middleware/core";
import { describe, expect, it } from "vitest";

import { createPiModelGateway } from "./pi-model-gateway.ts";

/**
 * The faux provider is registered under the pi-ai id "openai", so every call
 * exercises the gateway's real registry path. Nothing here touches the
 * network or a real key.
 */
const fauxModelDefinitions = [
  {
    id: "faux-1",
    name: "Faux One",
    reasoning: true,
    // Catalog prices in USD per million tokens; pi-ai's calculateCost reads
    // them for the per-message cost (the faux stream itself reports 0).
    cost: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0 },
  },
];

const credential = { apiKey: "sk-faux-key" };

const fauxDescriptor = {
  id: "faux-1",
  name: "Faux One",
  providerId: "openai",
  contextWindow: 128000,
  maxTokens: 16384,
  reasoning: true,
};

function createFauxGateway(): {
  gateway: ModelGateway;
  faux: FauxProviderHandle;
} {
  const faux = fauxProvider({
    provider: "openai",
    models: fauxModelDefinitions,
  });
  const gateway = createPiModelGateway({
    listProviders: () => [faux.provider],
  });
  return { gateway, faux };
}

function fauxTarget(modelId = "faux-1"): ModelTarget {
  return { providerId: "openai", modelId, credential };
}

async function collectEvents(
  gateway: ModelGateway,
  target: ModelTarget,
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of gateway.stream(target)) {
    events.push(event);
  }
  return events;
}

function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/** Drains the stream and returns the ProviderError it must fail with. */
async function streamFailure(
  gateway: ModelGateway,
  target: ModelTarget,
): Promise<ProviderError> {
  try {
    await collectEvents(gateway, target);
  } catch (error) {
    if (isProviderError(error)) {
      return error;
    }
    throw new Error(`expected a ProviderError, got: ${String(error)}`);
  }
  throw new Error("expected the stream to fail, but it completed");
}

function eventsOfType<TType extends ProviderStreamEvent["type"]>(
  events: readonly ProviderStreamEvent[],
  type: TType,
): Array<Extract<ProviderStreamEvent, { type: TType }>> {
  return events.filter(
    (event): event is Extract<ProviderStreamEvent, { type: TType }> =>
      event.type === type,
  );
}

describe("createPiModelGateway", () => {
  describe("listModels", () => {
    it("returns the provider catalog with the port's descriptor shape", async () => {
      const { gateway } = createFauxGateway();
      const models = await gateway.listModels({
        providerId: "openai",
        credential,
      });
      expect(models).toEqual([fauxDescriptor]);
    });

    it("returns an empty list for a provider id without a pi-ai provider", async () => {
      const { gateway } = createFauxGateway();
      // "openai-compatible" is in the registry, but its provider (built from
      // the credential's baseUrl behind the WP-14 SSRF-safe client) is not
      // wired yet, so there is no catalog to list.
      const models = await gateway.listModels({
        providerId: "openai-compatible",
        credential,
      });
      expect(models).toEqual([]);
    });
  });

  describe("findModel", () => {
    it("returns the catalog descriptor without a credential or network", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai", "faux-1")).toEqual(fauxDescriptor);
    });

    it("returns null for an unknown model id", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai", "no-such-model")).toBeNull();
    });

    it("returns null for a provider id without a pi-ai provider", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai-compatible", "faux-1")).toBeNull();
    });
  });

  describe("stream", () => {
    it("yields text deltas and ends with usage and done", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(
        eventsOfType(events, "text")
          .map((event) => event.text)
          .join(""),
      ).toBe("hola mundo");
      expect(events.at(-1)?.type).toBe("done");
      expect(events.at(-2)?.type).toBe("usage");
    });

    it("yields thinking deltas as thinking events", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("pensando..."), fauxText("listo")]),
      ]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(
        eventsOfType(events, "thinking")
          .map((event) => event.text)
          .join(""),
      ).toBe("pensando...");
      expect(
        eventsOfType(events, "text")
          .map((event) => event.text)
          .join(""),
      ).toBe("listo");
    });

    it("still completes with usage and done when the response is a tool call", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("search", { query: "middleware" })]),
      ]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(eventsOfType(events, "text")).toEqual([]);
      expect(events.at(-1)?.type).toBe("done");
      expect(events.at(-2)?.type).toBe("usage");
    });

    it("carries pi-ai's per-message cost in the usage event", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
      const events = await collectEvents(gateway, fauxTarget());
      const usage = eventsOfType(events, "usage")[0];
      if (usage === undefined) {
        throw new Error("expected a usage event before done");
      }
      // The port carries no transcript yet, so input is 0; the output is the
      // faux token estimate and the cost is calculateCost at the catalog
      // price (5 USD per million output tokens).
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(usage.costUsd).toBe((5 / 1_000_000) * usage.outputTokens);
    });
  });

  describe("§10 provider error mapping", () => {
    it.each([
      ["401: Incorrect API key provided", "invalid_api_key"],
      [
        "429: You exceeded your current quota, please check your plan and billing details",
        "insufficient_quota",
      ],
      ["429: Rate limit reached for requests", "rate_limited"],
      [
        "404: The model 'faux-x' does not exist or you do not have access to it",
        "model_not_found",
      ],
      [
        "400: This model's maximum context length is 4096 tokens, however you requested 5000 tokens",
        "context_too_long",
      ],
      ["Request timed out after 60000 ms", "provider_timeout"],
      [
        "503: The service is currently overloaded, please try again later",
        "provider_unavailable",
      ],
      [
        "The response was filtered by the content management policy",
        "content_filtered",
      ],
      ["Something completely unexpected happened", "unknown"],
    ])("maps %s to %s", async (errorMessage, code) => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], { stopReason: "error", errorMessage }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.code).toBe(code);
    });

    it("keeps the provider's raw text out of the error (S2)", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: "401: Incorrect API key provided sk-live-123",
        }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.code).toBe("invalid_api_key");
      // Only the code travels: no provider text, no key.
      expect(error.message).toBe("invalid_api_key");
      expect(String(error)).not.toContain("sk-live-123");
    });

    it("fails with model_not_found when the model is not in the catalog", async () => {
      const { gateway } = createFauxGateway();
      const error = await streamFailure(gateway, fauxTarget("no-such-model"));
      expect(error.code).toBe("model_not_found");
    });

    it("fails with model_not_found for a provider id without a pi-ai provider", async () => {
      const { gateway } = createFauxGateway();
      const error = await streamFailure(gateway, {
        providerId: "openai-compatible",
        modelId: "faux-1",
        credential,
      });
      expect(error.code).toBe("model_not_found");
    });

    it("never echoes the credential key in the error message", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: `Request rejected for key ${credential.apiKey}`,
        }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.message).not.toContain(credential.apiKey);
    });
  });
});
