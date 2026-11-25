import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { createPiAgentRuntime } from "@middleware/adapters";
import {
  type RunResponse,
  type RunStatus,
  runEventSchema,
  runResponseSchema,
} from "@middleware/contracts";
import type { AgentRuntime } from "@middleware/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type RunFailureCode,
  runFailureFallbackMessage,
  runFailureMessage,
  runFailureMessages,
} from "./messages.ts";
import {
  createIntegrationHarness,
  TEST_ORIGIN,
  type TestSession,
  testDatabaseUrl,
} from "./testing/integration-harness.ts";

type Harness = Awaited<ReturnType<typeof createIntegrationHarness>>;

const url = testDatabaseUrl();

/**
 * pi-ai's faux provider (§14): the real `createPiAgentRuntime` runs against
 * it, so the whole HTTP + engine + storage stack is real and no network is
 * ever touched. Holding a turn open mid-run uses the faux provider's own
 * control: an async response factory that awaits the test's gate.
 */
const fauxModelDefinitions = [
  {
    id: "test-model",
    // Catalog prices in USD per million tokens; pi-ai's calculateCost reads
    // them for the per-message cost (the faux stream itself reports 0).
    cost: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0 },
  },
];

function createFauxRuntime(): {
  runtime: AgentRuntime;
  faux: FauxProviderHandle;
} {
  const faux = fauxProvider({
    provider: "openai",
    models: fauxModelDefinitions,
  });
  return {
    faux,
    runtime: createPiAgentRuntime({ listProviders: () => [faux.provider] }),
  };
}

/** A gate the test holds closed to keep a run mid-turn (S2). */
const gated = (): { gate: Promise<void>; release: () => void } => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release?.() };
};

/** Queues one immediate faux reply for the next turn. */
const enqueueReply = (faux: FauxProviderHandle, output: string): void => {
  faux.setResponses([fauxAssistantMessage(output)]);
};

/** Queues one faux reply that stays open until the test releases it. */
const enqueueGatedReply = (
  faux: FauxProviderHandle,
  output: string,
  gate: Promise<void>,
): void => {
  faux.setResponses([
    async () => {
      await gate;
      return fauxAssistantMessage(output);
    },
  ]);
};

type SseFrame = { id: number; event: string; data: unknown };

/** Every §10 failure code renders its own Spanish sentence, never the code. */
describe("run failure copy", () => {
  it.each(Object.keys(runFailureMessages) as RunFailureCode[])(
    "maps %s to its Spanish sentence",
    (code) => {
      const message = runFailureMessage(code);
      expect(message).toBe(runFailureMessages[code]);
      expect(message).not.toEqual(code);
      expect(message.length).toBeGreaterThan(0);
    },
  );

  it("falls back to a generic Spanish sentence for a code with no entry", () => {
    const message = runFailureMessage("codigo_que_no_existe");
    expect(message).toBe(runFailureFallbackMessage);
    expect(message).not.toContain("codigo_que_no_existe");
  });
});

const parseFrame = (block: string): SseFrame => {
  let id = -1;
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("id: ")) id = Number(line.slice(4));
    else if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data = line.slice(6);
  }
  return { id, event, data: JSON.parse(data) as unknown };
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("read timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** Reads up to `maxFrames` frames, or until the stream ends. */
const readFrames = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxFrames: number,
): Promise<SseFrame[]> => {
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  while (frames.length < maxFrames) {
    const chunk = await withTimeout(reader.read(), 15_000);
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      frames.push(parseFrame(buffer.slice(0, index)));
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf("\n\n");
    }
  }
  return frames;
};

const bodyReader = (res: Response) => {
  const reader = res.body?.getReader();
  if (reader === undefined) throw new Error("response has no body");
  return reader;
};

const runListOf = async (body: unknown): Promise<RunResponse[]> => {
  const { runs } = z.object({ runs: z.array(z.unknown()) }).parse(body);
  return z.array(runResponseSchema).parse(runs);
};

describe.skipIf(url === undefined)("run routes (postgres)", () => {
  let harness: Harness;
  let ana: TestSession;
  let beto: TestSession;
  let agentId: string;
  let otherAgentId: string;
  let faux: FauxProviderHandle;

  beforeAll(async () => {
    const modelLayer = createFauxRuntime();
    faux = modelLayer.faux;
    harness = await createIntegrationHarness(
      url ?? "",
      undefined,
      undefined,
      undefined,
      modelLayer.runtime,
    );
    ana = await harness.signUp("Ana");
    beto = await harness.signUp("Beto");
    const credential = async (session: TestSession, alias: string) => {
      const res = await call(session, "POST", "/api/credentials", {
        providerId: "openai",
        alias,
        apiKey: `sk-test-${alias}-wxyz`,
      });
      expect(res.status).toBe(201);
      return z.object({ id: z.uuid() }).parse(await res.json()).id;
    };
    const createAgent = async (
      session: TestSession,
      name: string,
      credentialId: string,
    ) => {
      const res = await call(session, "POST", "/api/agents", {
        name,
        version: {
          instructions: `Sos ${name}.`,
          providerId: "openai",
          modelId: "test-model",
          credentialId,
          params: { temperature: 0.2 },
          tools: [],
        },
      });
      expect(res.status).toBe(201);
      return z.object({ id: z.uuid() }).parse(await res.json()).id;
    };
    agentId = await createAgent(ana, "Soporte", await credential(ana, "ana-1"));
    otherAgentId = await createAgent(
      ana,
      "Otro",
      await credential(ana, "ana-2"),
    );
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  const call = (
    session: TestSession,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    harness.app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        ...(session ? { cookie: session.cookie } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const expectError = async (res: Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: { code, message: expect.any(String) },
    });
  };

  const startRun = async (session: TestSession, input: string) => {
    const res = await call(session, "POST", "/api/runs", { agentId, input });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    return res;
  };

  /** Polls the run list until the run reaches `status` (S7). */
  const waitForStatus = async (
    session: TestSession,
    runId: string,
    status: RunStatus,
  ): Promise<RunResponse> => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const list = await call(session, "GET", "/api/runs");
      const found = (await runListOf(await list.json())).find(
        (run) => run.id === runId,
      );
      if (found !== undefined && found.status === status) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`run ${runId} never reached ${status}`);
  };

  /** The ids are consecutive and the payloads are valid §10 events. */
  const expectGapless = (frames: SseFrame[]): void => {
    frames.forEach((frame, index) => {
      expect(frame.id).toBe(index + 1);
      runEventSchema.parse(frame.data);
    });
  };

  const runIdOf = (frame: SseFrame | undefined): string => {
    if (frame === undefined) throw new Error("stream was empty");
    const started = runEventSchema.parse(frame.data);
    if (started.type !== "run.started") throw new Error("wrong first event");
    return started.runId;
  };

  it("streams a run end to end with gapless ids", async () => {
    enqueueReply(faux, "Hola, ¿cómo estás?");

    const res = await startRun(ana, "Hola");
    const frames = await readFrames(bodyReader(res), 1000);

    expectGapless(frames);
    const first = frames[0];
    if (first === undefined) throw new Error("stream was empty");
    expect(first.event).toBe("run.started");
    expect(runIdOf(first)).toBeTruthy();
    const last = frames.at(-1);
    if (last === undefined) throw new Error("stream never terminated");
    expect(last.event).toBe("run.completed");
    const completed = runEventSchema.parse(last.data);
    if (completed.type !== "run.completed") {
      throw new Error("wrong terminal event");
    }
    expect(completed.output).toBe("Hola, ¿cómo estás?");
    const deltas = frames.filter((frame) => frame.event === "message.delta");
    expect(deltas.length).toBeGreaterThanOrEqual(1);
  });

  it("replays after Last-Event-ID, then the terminal one", async () => {
    const gate = gated();
    enqueueGatedReply(faux, "Respuesta lenta.", gate.gate);

    const res = await startRun(ana, "Lento");
    const reader = bodyReader(res);
    const started = await readFrames(reader, 1);
    const first = started[0];
    if (first === undefined) throw new Error("stream was empty");
    expect(first.event).toBe("run.started");
    const runId = runIdOf(first);
    // The client leaves mid-run (S2); the run must keep going without it.
    await reader.cancel();

    gate.release();
    await waitForStatus(ana, runId, "succeeded");

    const resumed = await call(
      ana,
      "GET",
      `/api/runs/${runId}/events`,
      undefined,
      { "last-event-id": String(first.id) },
    );
    expect(resumed.status).toBe(200);
    const frames = await readFrames(bodyReader(resumed), 1000);

    expect(frames.length).toBeGreaterThan(1);
    frames.forEach((frame, index) => {
      expect(frame.id).toBe(first.id + 1 + index);
      expect(frame.event).not.toBe("run.started");
      runEventSchema.parse(frame.data);
    });
    expect(frames.at(-1)?.event).toBe("run.completed");
  });

  it("resumes a run for a second client", async () => {
    const gate = gated();
    enqueueGatedReply(faux, "Para otro cliente.", gate.gate);

    const res = await startRun(ana, "Otro cliente");
    const reader = bodyReader(res);
    const started = await readFrames(reader, 1);
    const runId = runIdOf(started[0]);
    await reader.cancel();

    gate.release();
    await waitForStatus(ana, runId, "succeeded");

    // No Last-Event-ID: the whole run, in order, from the store (S6).
    const replay = await call(ana, "GET", `/api/runs/${runId}/events`);
    expect(replay.status).toBe(200);
    const frames = await readFrames(bodyReader(replay), 1000);

    expectGapless(frames);
    expect(frames[0]?.event).toBe("run.started");
    expect(frames.at(-1)?.event).toBe("run.completed");
  });

  it("ends the stream when the run row is terminal without its terminal event", async () => {
    enqueueReply(faux, "Sin cierre.");
    const streamed = await startRun(ana, "Sin evento final");
    const frames = await readFrames(bodyReader(streamed), 1000);
    const runId = runIdOf(frames[0]);
    expect(frames.at(-1)?.event).toBe("run.completed");

    // Wedged writer: the run row stays terminal but its terminal event
    // disappears from the store — exactly what a broken executor leaves
    // behind (§10).
    await harness.sql`delete from run_event
      where workspace_id = ${ana.workspaceId}
        and run_id = ${runId}
        and type = 'run.completed'`;
    const withoutTerminal = frames.filter(
      (frame) => frame.event !== "run.completed",
    );
    const lastId = withoutTerminal.at(-1)?.id ?? 0;

    // Reconnecting from the last surviving frame: the store has nothing new
    // and the row is terminal, so the reader must see the stream end instead
    // of polling forever — and no invented event may arrive (§10).
    const resumed = await call(
      ana,
      "GET",
      `/api/runs/${runId}/events`,
      undefined,
      { "last-event-id": String(lastId) },
    );
    expect(resumed.status).toBe(200);
    const tail = await readFrames(bodyReader(resumed), 1000);
    expect(tail).toEqual([]);
  });

  it("renders run.failed with the Spanish copy of its code", async () => {
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "401: Incorrect API key provided",
      }),
    ]);

    const res = await startRun(ana, "Fallame");
    const frames = await readFrames(bodyReader(res), 1000);
    const last = frames.at(-1);
    if (last === undefined) throw new Error("stream was empty");
    const failed = runEventSchema.parse(last.data);
    if (failed.type !== "run.failed") throw new Error("wrong terminal event");

    expect(failed.code).toBe("invalid_api_key");
    expect(failed.message).toBe(runFailureMessages.invalid_api_key);
    // Never the raw code, never the provider's text (S2, §8).
    expect(failed.message).not.toContain("invalid_api_key");
    expect(failed.message).not.toContain("401");
  });

  it("cancelling a run produces run.cancelled", async () => {
    const gate = gated();
    enqueueGatedReply(faux, "Nunca llega.", gate.gate);

    const res = await startRun(ana, "Cancelame");
    const reader = bodyReader(res);
    const started = await readFrames(reader, 1);
    const first = started[0];
    if (first === undefined) throw new Error("stream was empty");
    const runId = runIdOf(first);

    const cancelRes = await call(ana, "POST", `/api/runs/${runId}/cancel`);
    expect(cancelRes.status).toBe(200);
    const cancelled = runResponseSchema.parse(await cancelRes.json());
    expect(cancelled.status).toBe("cancelled");

    gate.release();
    // The original stream still ends at the §10 terminal event (S11); the
    // frames read before and after the cancel are one gapless sequence.
    const rest = await readFrames(reader, 1000);
    const frames = [...started, ...rest];
    expectGapless(frames);
    expect(frames.at(-1)?.event).toBe("run.cancelled");
    expect((await waitForStatus(ana, runId, "cancelled")).status).toBe(
      "cancelled",
    );
  });

  it("answers 202 and enqueues a background run", async () => {
    enqueueReply(faux, "En segundo plano.");

    const res = await call(ana, "POST", "/api/runs", {
      agentId,
      input: "Segundo plano",
      background: true,
    });
    expect(res.status).toBe(202);
    const { runId } = z.object({ runId: z.uuid() }).parse(await res.json());
    await waitForStatus(ana, runId, "succeeded");

    // The run happened even though nobody streamed it: its events are in
    // the store, resumable by any client (S6).
    const replay = await call(ana, "GET", `/api/runs/${runId}/events`);
    const frames = await readFrames(bodyReader(replay), 1000);
    expectGapless(frames);
    expect(frames[0]?.event).toBe("run.started");
    expect(frames.at(-1)?.event).toBe("run.completed");
  });

  it("lists runs filtered by status and agent", async () => {
    enqueueReply(faux, "Terminada.");
    const streamed = await startRun(ana, "Listame");
    const frames = await readFrames(bodyReader(streamed), 1000);
    const runId = runIdOf(frames[0]);

    const succeeded = await call(
      ana,
      "GET",
      `/api/runs?status=succeeded&agentId=${agentId}`,
    );
    expect(succeeded.status).toBe(200);
    const listed = await runListOf(await succeeded.json());
    expect(listed.filter((run) => run.id === runId).length).toBe(1);
    expect(listed.every((run) => run.agentId === agentId)).toBe(true);

    const empty = await call(ana, "GET", `/api/runs?agentId=${otherAgentId}`);
    expect(await runListOf(await empty.json())).toEqual([]);

    await expectError(
      await call(ana, "GET", "/api/runs?status=inventado"),
      400,
      "invalid_request",
    );
  });

  it("answers 404 for another workspace's run on every run route", async () => {
    enqueueReply(faux, "Privada.");
    const streamed = await startRun(ana, "Privada");
    const frames = await readFrames(bodyReader(streamed), 1000);
    const runId = runIdOf(frames[0]);
    await waitForStatus(ana, runId, "succeeded");

    await expectError(
      await call(beto, "GET", `/api/runs/${runId}/events`),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "POST", `/api/runs/${runId}/cancel`),
      404,
      "not_found",
    );
    const listed = await runListOf(
      await (await call(beto, "GET", "/api/runs")).json(),
    );
    expect(listed.map((run) => run.id)).not.toContain(runId);
  });

  it("validates the run input and the agent's workspace", async () => {
    await expectError(
      await call(ana, "POST", "/api/runs", { agentId, input: "" }),
      400,
      "invalid_request",
    );
    await expectError(
      await call(ana, "POST", "/api/runs", { agentId, input: "   " }),
      400,
      "invalid_request",
    );
    const foreignCredential = z.object({ id: z.uuid() }).parse(
      await (
        await call(beto, "POST", "/api/credentials", {
          providerId: "openai",
          alias: "beto-1",
          apiKey: "sk-test-beto-wxyz",
        })
      ).json(),
    ).id;
    const foreignAgent = z.object({ id: z.uuid() }).parse(
      await (
        await call(beto, "POST", "/api/agents", {
          name: "Ajeno",
          version: {
            instructions: "Sos ajeno.",
            providerId: "openai",
            modelId: "test-model",
            credentialId: foreignCredential,
            params: { temperature: 0.2 },
            tools: [],
          },
        })
      ).json(),
    ).id;
    await expectError(
      await call(ana, "POST", "/api/runs", {
        agentId: foreignAgent,
        input: "Hola",
      }),
      404,
      "not_found",
    );
  });
});
