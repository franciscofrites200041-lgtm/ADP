import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  type Message,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeTurn,
  ModelTarget,
} from "@middleware/core";
import { describe, expect, it } from "vitest";

import { createPiAgentRuntime } from "./agent-runtime.ts";

/**
 * The faux provider is registered under the pi-ai id "openai", so every call
 * exercises the real pi-agent-core path (a fresh `Agent` per turn, the real
 * event loop). Nothing here touches the network or a real key.
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

function createFauxRuntime(): {
  runtime: AgentRuntime;
  faux: FauxProviderHandle;
} {
  const faux = fauxProvider({
    provider: "openai",
    models: fauxModelDefinitions,
  });
  const runtime = createPiAgentRuntime({
    listProviders: () => [faux.provider],
  });
  return { runtime, faux };
}

function fauxTarget(): ModelTarget {
  return { providerId: "openai", modelId: "faux-1", credential };
}

/** Drains a whole turn; the iterable always ends at its terminal event. */
async function collectEvents(
  runtime: AgentRuntime,
  input: AgentRuntimeTurn,
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.streamTurn(input)) {
    events.push(event);
  }
  return events;
}

function expectDone(
  events: readonly AgentRuntimeEvent[],
): Extract<AgentRuntimeEvent, { type: "done" }> {
  const last = events.at(-1);
  if (last?.type !== "done") {
    throw new Error(`expected a done event, got: ${JSON.stringify(last)}`);
  }
  return last;
}

/** Human-readable transcript the faux provider actually received. */
function summarize(messages: readonly Message[]): string[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
    }
    if (message.role === "assistant") {
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    }
    return message.role;
  });
}

describe("createPiAgentRuntime", () => {
  it("streams text events and closes with usage and done", async () => {
    const { runtime, faux } = createFauxRuntime();
    faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
    const events = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("hola mundo");
    const done = expectDone(events);
    expect(done.output).toBe("hola mundo");
    expect(done.usage.outputTokens).toBeGreaterThan(0);
    expect(done.usage.costUsd).toBeGreaterThanOrEqual(0);
    expect(events.at(-2)?.type).toBe("usage");
  });

  it("keeps multi-turn history: the second turn gets the first reply", async () => {
    const { runtime, faux } = createFauxRuntime();
    // Factories capture exactly what each provider request carried.
    const seen: TranscriptContext["messages"][] = [];
    faux.setResponses([
      (context) => {
        seen.push(context.messages);
        return fauxAssistantMessage([fauxText("primera")]);
      },
      (context) => {
        seen.push(context.messages);
        return fauxAssistantMessage([fauxText("segunda")]);
      },
    ]);

    const first = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(expectDone(first).output).toBe("primera");

    const second = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [
        { role: "user", text: "hola" },
        { role: "assistant", text: "primera" },
        { role: "user", text: "seguimos" },
      ],
    });
    expect(expectDone(second).output).toBe("segunda");
    // The runtime is stateless: the first request carries only its own turn.
    expect(summarize(seen[0] ?? [])).toEqual(["hola"]);
    expect(summarize(seen[1] ?? [])).toEqual(["hola", "primera", "seguimos"]);
  });

  it("passes the system prompt to the provider", async () => {
    const { runtime, faux } = createFauxRuntime();
    const seen: TranscriptContext["messages"][] = [];
    faux.setResponses([
      (context) => {
        seen.push(context.messages);
        return fauxAssistantMessage([fauxText("listo")]);
      },
    ]);
    await collectEvents(runtime, {
      model: fauxTarget(),
      systemPrompt: "Sos un asistente de pruebas.",
      messages: [{ role: "user", text: "hola" }],
    });
    expect(seen[0]?.some((message) => message.role === "system")).toBe(true);
  });

  it("streams thinking deltas as thinking events", async () => {
    const { runtime, faux } = createFauxRuntime();
    faux.setResponses([
      fauxAssistantMessage([fauxThinking("pensando..."), fauxText("listo")]),
    ]);
    const events = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(
      events
        .filter((event) => event.type === "thinking")
        .map((event) => event.text)
        .join(""),
    ).toBe("pensando...");
    // Thinking is not part of the turn's output.
    expect(expectDone(events).output).toBe("listo");
  });

  it("maps a provider failure to one error event with its §10 code", async () => {
    const { runtime, faux } = createFauxRuntime();
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "401: Incorrect API key provided",
      }),
    ]);
    const events = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(events.at(-1)).toEqual({
      type: "error",
      code: "invalid_api_key",
      message: "invalid_api_key",
    });
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.some((event) => event.type === "usage")).toBe(false);
  });

  it("never lets the API key appear in the events (S12)", async () => {
    const { runtime, faux } = createFauxRuntime();
    // The failure path is where a provider echo could leak the key.
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: `Request rejected for key ${credential.apiKey}`,
      }),
    ]);
    const failureEvents = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(JSON.stringify(failureEvents)).not.toContain(credential.apiKey);

    // And the happy path carries no key either.
    faux.appendResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
    const happyEvents = await collectEvents(runtime, {
      model: fauxTarget(),
      messages: [{ role: "user", text: "hola" }],
    });
    expect(JSON.stringify(happyEvents)).not.toContain(credential.apiKey);
    expect(expectDone(happyEvents).output).toBe("hola mundo");
  });

  it("reports an unknown model as a model_not_found error event", async () => {
    const { runtime } = createFauxRuntime();
    const events = await collectEvents(runtime, {
      model: { providerId: "openai", modelId: "no-such-model", credential },
      messages: [{ role: "user", text: "hola" }],
    });
    expect(events).toEqual([
      { type: "error", code: "model_not_found", message: "model_not_found" },
    ]);
  });
});
