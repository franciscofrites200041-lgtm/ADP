import { randomUUID } from "node:crypto";
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
  RunService,
  SecretVault,
} from "@middleware/core";
import { createRunService } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createAgentRepo } from "./agent-repo.ts";
import { createPiAgentRuntime } from "./agent-runtime.ts";
import { createBackgroundTasks } from "./background-tasks.ts";
import { createConversationRepo } from "./conversation-repo.ts";
import { createCredentialRepo } from "./credential-repo.ts";
import { createInMemoryLiveEventBus } from "./live-event-bus.ts";
import { createMessageRepo } from "./message-repo.ts";
import { createRunEventStore } from "./run-event-store.ts";
import { createRunRepo } from "./run-repo.ts";
import { testDatabaseUrl } from "./testing/test-database-url.ts";
import { createUsageRepo } from "./usage-repo.ts";

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

// Opt-in: `DATABASE_URL_TEST`, and only the disposable database, validated
// in one shared place (ADR-0006).
const integrationUrl = testDatabaseUrl();

describe.skipIf(!integrationUrl)("run engine (postgres integration)", () => {
  const sql = postgres(integrationUrl ?? "", { max: 5 });
  const db = drizzle(sql, { schema });
  const agentRepo = createAgentRepo(db);
  const credentialRepo = createCredentialRepo(db);
  const conversationRepo = createConversationRepo(db);
  const messageRepo = createMessageRepo(db);
  const runRepo = createRunRepo(db);
  const runEventStore = createRunEventStore(db);
  const usageRepo = createUsageRepo(db);
  const backgroundTasks = createBackgroundTasks();
  const liveEventBus = createInMemoryLiveEventBus();
  // The vault is the unit under test elsewhere; the engine only needs the
  // port's contract (open returns what seal sealed), so a map stands in.
  const vaultSecrets = new Map<string, string>();
  const secretVault: SecretVault = {
    async seal(workspaceId, ref, plaintext) {
      vaultSecrets.set(`${workspaceId}:${ref.table}:${ref.id}`, plaintext);
      return {
        ciphertext: Buffer.from(ref.id).toString("base64"),
        iv: "aXY=",
        authTag: "dGFn",
        kekVersion: "1",
      };
    },
    async open(workspaceId, ref) {
      const plaintext = vaultSecrets.get(
        `${workspaceId}:${ref.table}:${ref.id}`,
      );
      if (plaintext === undefined) throw new Error("unknown secret");
      return plaintext;
    },
  };

  // One faux provider for the whole suite: the runtime registry and the
  // responses the test queues must be the same instance.
  const faux = fauxProvider({
    provider: "openai",
    models: fauxModelDefinitions,
  });

  const service: RunService = createRunService({
    agentRepo,
    credentialRepo,
    conversationRepo,
    messageRepo,
    runRepo,
    runEventStore,
    liveEventBus,
    backgroundTasks,
    agentRuntime: createPiAgentRuntime({
      listProviders: () => [faux.provider],
    }),
    secretVault,
    usageRepo,
    clock: { now: () => new Date() },
    idGen: { newId: createId },
  });

  const workspaces: string[] = [];

  /** Seeds an agent version with a valid credential in a fresh workspace. */
  const seed = async () => {
    const workspaceId = randomUUID();
    workspaces.push(workspaceId);
    const credentialId = createId();
    const secret = await secretVault.seal(
      workspaceId,
      { table: "provider_credential", id: credentialId },
      credential.apiKey,
    );
    await credentialRepo.insert(workspaceId, {
      id: credentialId,
      workspaceId,
      providerId: "openai",
      alias: "faux",
      last4: "f3k",
      baseUrl: null,
      status: "valid",
      createdBy: randomUUID(),
      archivedAt: null,
      secret,
    });
    const agentId = createId();
    const { version } = await agentRepo.insertWithFirstVersion(
      workspaceId,
      {
        id: agentId,
        workspaceId,
        name: "agente",
        description: null,
        currentVersionId: null,
        templateId: null,
        createdBy: randomUUID(),
        archivedAt: null,
      },
      {
        id: createId(),
        agentId,
        workspaceId,
        version: 1,
        instructions: "Sos un asistente de pruebas.",
        providerId: "openai",
        modelId: "faux-1",
        credentialId,
        params: {},
        tools: [],
      },
    );
    return { workspaceId, agentId, versionId: version.id };
  };

  afterAll(async () => {
    if (workspaces.length) {
      const filter = sql(workspaces);
      await sql`delete from run_event where workspace_id in ${filter}`;
      await sql`delete from usage_record where workspace_id in ${filter}`;
      await sql`delete from message where workspace_id in ${filter}`;
      await sql`delete from run where workspace_id in ${filter}`;
      await sql`delete from conversation where workspace_id in ${filter}`;
      await sql`delete from provider_credential where workspace_id in ${filter}`;
      await sql`delete from agent_version where workspace_id in ${filter}`;
      await sql`delete from agent where workspace_id in ${filter}`;
    }
    await sql.end();
  });

  it("runs end to end: queued row, streamed turn, gap-free events, usage, succeeded", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
    const { workspaceId, agentId, versionId } = await seed();

    const started = await service.startRun(workspaceId, randomUUID(), {
      agentId,
      input: "hola",
    });
    // The run survives the client disconnecting: nothing here holds the
    // request; the tracked execution finishes on its own.
    await expect(backgroundTasks.drain(15_000)).resolves.toBe(true);

    const run = await runRepo.findById(workspaceId, started.runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.output).toBe("hola mundo");
    expect(run?.startedAt).not.toBeNull();
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.leaseUntil).toBeNull();
    expect(run?.turnsCompleted).toBe(1);

    // The stored event rows are gap-free in `seq` (S4).
    const events = await runEventStore.listAfter(workspaceId, started.runId, 0);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((row) => row.seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events[0]?.event.type).toBe("run.started");
    expect(events[0]?.event).toMatchObject({
      agentVersionId: versionId,
      model: "faux-1",
    });
    const types = events.map((row) => row.event.type);
    expect(types).toContain("message.delta");
    expect(types).toContain("message.completed");
    expect(types).toContain("usage");
    expect(types.at(-1)).toBe("run.completed");

    // The conversation keeps the user and the final assistant message.
    const page = await messageRepo.listByConversation(
      workspaceId,
      started.conversationId,
      {},
    );
    expect(page.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(page.messages[1]?.content).toBe("hola mundo");

    // One usage record for the assistant message, tokens from the provider.
    const usage = await sql<
      { input_tokens: number; output_tokens: number; cost_usd: string }[]
    >`select input_tokens, output_tokens, cost_usd from usage_record
      where run_id = ${started.runId}`;
    expect(usage).toHaveLength(1);
    expect(usage[0]?.input_tokens).toBeGreaterThan(0);
    expect(usage[0]?.output_tokens).toBeGreaterThan(0);
  });

  it("reads another workspace's agent and conversation as missing (S4)", async () => {
    // Two independent tenants, each with its own agent and conversation.
    const mine = await seed();
    const theirs = await seed();
    const foreignConversation = await conversationRepo.insert(
      theirs.workspaceId,
      {
        id: createId(),
        agentId: theirs.agentId,
        title: null,
      },
    );

    // A foreign agent id: rejected with the missing-resource code, before
    // anything is written.
    await expect(
      service.startRun(mine.workspaceId, randomUUID(), {
        agentId: theirs.agentId,
        input: "hola",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    // A conversation of another workspace: the same missing-resource code.
    await expect(
      service.startRun(mine.workspaceId, randomUUID(), {
        agentId: mine.agentId,
        conversationId: foreignConversation.id,
        input: "hola",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    // Nothing was written on behalf of the rejected requests: no run row, no
    // conversation and no event in the caller's workspace.
    const rows = await sql<
      { runs: number; conversations: number; events: number }[]
    >`
      select
        (select count(*)::int from run
          where workspace_id = ${mine.workspaceId}) as runs,
        (select count(*)::int from conversation
          where workspace_id = ${mine.workspaceId}) as conversations,
        (select count(*)::int from run_event
          where workspace_id = ${mine.workspaceId}) as events`;
    expect(rows[0]).toEqual({ runs: 0, conversations: 0, events: 0 });
    // And the foreign tenant's rows were never touched either.
    const foreignRows = await sql<{ runs: number; events: number }[]>`
      select
        (select count(*)::int from run
          where workspace_id = ${theirs.workspaceId}) as runs,
        (select count(*)::int from run_event
          where workspace_id = ${theirs.workspaceId}) as events`;
    expect(foreignRows[0]).toEqual({ runs: 0, events: 0 });
  });
});
