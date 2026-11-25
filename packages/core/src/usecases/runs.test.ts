import type { CreateRunRequest, RunEvent } from "@middleware/contracts";
import { describe, expect, it, vi } from "vitest";

import type { Conversation } from "../domain/conversation.ts";
import type { UsageRecord, UsageRecordDraft } from "../domain/usage.ts";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeTurn,
  RuntimeUsage,
} from "../ports/agent-runtime.ts";
import type { ConversationRepo } from "../ports/conversation-repo.ts";
import type { MessageRepo } from "../ports/message-repo.ts";
import type { UsageRepo } from "../ports/usage-repo.ts";
import { createInMemoryAgentRepo } from "../testing/in-memory-agent-ports.ts";
import { createInMemoryPorts } from "../testing/in-memory-ports.ts";
import {
  createInMemoryBackgroundTasks,
  createInMemoryLiveEventBus,
  createInMemoryRunEventStore,
  createInMemoryRunRepo,
} from "../testing/in-memory-run-ports.ts";
import {
  createRunService,
  DEFAULT_RUN_LIMITS,
  type RunLimits,
} from "./runs.ts";

const WORKSPACE_A = "0190a5f2-0000-7000-8000-00000000000a";
const USER = "0190a5f2-0000-7000-8000-0000000000a1";
const API_KEY = "sk-test-secret-9f3k";
const BASE_TIME = new Date("2026-11-02T12:00:00.000Z");

const makeIdGen = () => {
  let last = 0;
  return {
    newId: () => `0190a5f2-7b1c-7d3e-8f00-${String(++last).padStart(12, "0")}`,
  };
};

const clock = { now: () => new Date(BASE_TIME.getTime()) };

const testLimits = (overrides: Partial<RunLimits>): RunLimits => ({
  ...DEFAULT_RUN_LIMITS,
  ...overrides,
});

/** A deferred the test resolves to hold a turn open (cancellation test). */
function deferred() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** One scripted turn of the fake runtime. */
type ScriptedTurn = {
  deltas?: string[];
  thinking?: string[];
  /** Held before the terminal events, so the test can act mid-turn. */
  gate?: Promise<void>;
  delayMs?: number;
  usage?: RuntimeUsage;
  output?: string;
  error?: "invalid_api_key" | "rate_limited";
  /** Throws instead of ending the turn (unexpected failure test). */
  crash?: Error;
};

function scriptedRuntime(script: readonly ScriptedTurn[]): AgentRuntime {
  let index = 0;
  return {
    async *streamTurn(
      _turn: AgentRuntimeTurn,
    ): AsyncGenerator<AgentRuntimeEvent> {
      const step = script[index];
      index += 1;
      if (step === undefined) {
        yield { type: "error", code: "unknown", message: "unknown" };
        return;
      }
      for (const text of step.deltas ?? []) {
        yield { type: "text", text };
      }
      for (const text of step.thinking ?? []) {
        yield { type: "thinking", text };
      }
      if (step.gate !== undefined) await step.gate;
      if (step.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      }
      if (step.crash !== undefined) throw step.crash;
      if (step.error !== undefined) {
        yield {
          type: "error",
          code: step.error,
          message: step.error,
        };
        return;
      }
      const usage = step.usage ?? {
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
      };
      yield { type: "usage", ...usage };
      yield {
        type: "done",
        output: step.output ?? (step.deltas ?? []).join(""),
        usage,
      };
    },
  };
}

function createInMemoryConversationRepo(): ConversationRepo & {
  rows: Conversation[];
} {
  const rows: Conversation[] = [];
  return {
    rows,
    async insert(workspaceId, draft) {
      const row: Conversation = {
        ...draft,
        workspaceId,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
        archivedAt: null,
      };
      rows.push(row);
      return { ...row };
    },
    async findById(workspaceId, id) {
      const row = rows.find(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          candidate.id === id &&
          candidate.archivedAt === null,
      );
      return row ? { ...row } : null;
    },
    async listByWorkspace() {
      return [];
    },
    async rename() {
      return null;
    },
    async archive() {
      return null;
    },
  };
}

function createInMemoryMessageRepo(): MessageRepo & {
  rows: Awaited<ReturnType<MessageRepo["append"]>>[];
} {
  type MessageRow = Awaited<ReturnType<MessageRepo["append"]>>;
  const rows: MessageRow[] = [];
  return {
    rows,
    async append(workspaceId, draft) {
      const row: MessageRow = { ...draft, workspaceId, createdAt: BASE_TIME };
      rows.push(row);
      return { ...row };
    },
    async listByConversation(workspaceId, conversationId) {
      return {
        messages: rows
          .filter(
            (row) =>
              row.workspaceId === workspaceId &&
              row.conversationId === conversationId,
          )
          .map((row) => ({ ...row })),
        nextCursor: null,
      };
    },
  };
}

function createInMemoryUsageRepo(): UsageRepo & {
  records: UsageRecordDraft[];
} {
  const records: UsageRecordDraft[] = [];
  return {
    records,
    async insert(workspaceId, record): Promise<UsageRecord> {
      records.push(record);
      return {
        ...record,
        id: `usage-${records.length}`,
        workspaceId,
        createdAt: BASE_TIME,
      };
    },
  };
}

function createSetup(
  options: { limits?: RunLimits; runtime?: AgentRuntime } = {},
) {
  const idGen = makeIdGen();
  const runRepo = createInMemoryRunRepo(clock);
  const runEventStore = createInMemoryRunEventStore();
  const liveEventBus = createInMemoryLiveEventBus();
  const backgroundTasks = createInMemoryBackgroundTasks();
  const agentRepo = createInMemoryAgentRepo();
  const ports = createInMemoryPorts();
  const conversationRepo = createInMemoryConversationRepo();
  const messageRepo = createInMemoryMessageRepo();
  const usageRepo = createInMemoryUsageRepo();
  const runtime =
    options.runtime ?? scriptedRuntime([{ deltas: ["hola ", "mundo"] }]);
  const service = createRunService({
    agentRepo,
    credentialRepo: ports.deps.credentialRepo,
    conversationRepo,
    messageRepo,
    runRepo,
    runEventStore,
    liveEventBus,
    backgroundTasks,
    agentRuntime: runtime,
    secretVault: ports.deps.secretVault,
    usageRepo,
    clock,
    idGen,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  return {
    service,
    idGen,
    runRepo,
    runEventStore,
    liveEventBus,
    backgroundTasks,
    agentRepo,
    credentialRepo: ports.deps.credentialRepo,
    secretVault: ports.deps.secretVault,
    conversationRepo,
    messageRepo,
    usageRepo,
  };
}

type Setup = ReturnType<typeof createSetup>;

/** Agent + active credential, sealed through the fake vault. */
async function seedAgent(setup: Setup, workspaceId: string) {
  const credentialId = setup.idGen.newId();
  const secret = await setup.secretVault.seal(
    workspaceId,
    { table: "provider_credential", id: credentialId },
    API_KEY,
  );
  await setup.credentialRepo.insert(workspaceId, {
    id: credentialId,
    workspaceId,
    providerId: "openai",
    alias: "faux",
    last4: "9f3k",
    baseUrl: null,
    status: "valid",
    createdBy: USER,
    archivedAt: null,
    secret,
  });
  const agentId = setup.idGen.newId();
  const versionId = setup.idGen.newId();
  const { version } = await setup.agentRepo.insertWithFirstVersion(
    workspaceId,
    {
      id: agentId,
      workspaceId,
      name: "agente",
      description: null,
      currentVersionId: null,
      templateId: null,
      createdBy: USER,
      archivedAt: null,
    },
    {
      id: versionId,
      agentId,
      workspaceId,
      version: 1,
      instructions: "Sos un asistente de pruebas.",
      providerId: "openai",
      modelId: "gpt-5",
      credentialId,
      params: {},
      tools: [],
    },
  );
  return { agentId, versionId: version.id };
}

/** A run row seeded directly, so tests control `turnsCompleted` and leases. */
function seedRun(
  setup: Setup,
  options: {
    workspaceId: string;
    agentId: string;
    versionId: string;
    conversationId?: string | null;
    turnsCompleted?: number;
    startedAt?: Date | null;
    leaseUntil?: Date | null;
    status?: "queued" | "running";
  },
) {
  const runId = setup.idGen.newId();
  setup.runRepo.runs.push({
    id: runId,
    workspaceId: options.workspaceId,
    agentId: options.agentId,
    agentVersionId: options.versionId,
    conversationId: options.conversationId ?? null,
    status: options.status ?? "queued",
    input: "hola",
    output: null,
    errorCode: null,
    errorMessage: null,
    turnsCompleted: options.turnsCompleted ?? 0,
    checkpoint: null,
    leaseUntil: options.leaseUntil ?? null,
    queuedAt: BASE_TIME,
    startedAt: options.startedAt ?? null,
    finishedAt: null,
  });
  return runId;
}

const eventsOf = (setup: Setup, runId: string): RunEvent[] =>
  setup.runEventStore.events
    .filter((row) => row.runId === runId)
    .map((row) => row.event);

const eventTypesOf = (setup: Setup, runId: string): string[] =>
  eventsOf(setup, runId).map((event) => event.type);

const runOf = (setup: Setup, runId: string) => {
  const run = setup.runRepo.runs.find((row) => row.id === runId);
  expect(run).toBeDefined();
  return run as NonNullable<typeof run>;
};

describe("startRun", () => {
  it("creates the conversation, the queued run and the user message, and returns before the model answers", async () => {
    const gate = deferred();
    // The gated runtime holds the turn open until the test releases it, so
    // the assertions below see the world before the model has answered.
    const s = createSetup({
      runtime: scriptedRuntime([{ deltas: ["hola"], gate: gate.promise }]),
    });
    const ws = WORKSPACE_A;
    const { agentId } = await seedAgent(s, ws);

    const result = await s.service.startRun(ws, USER, {
      agentId,
      input: "hola",
    } satisfies CreateRunRequest);

    expect(result.runId).toBeDefined();
    expect(result.conversationId).toBeDefined();
    // The caller got its answer while the execution is still pending.
    expect(s.backgroundTasks.tasks).toHaveLength(1);
    const conversation = s.conversationRepo.rows.find(
      (row) => row.id === result.conversationId,
    );
    expect(conversation?.agentId).toBe(agentId);
    const userMessage = s.messageRepo.rows.at(-1);
    expect(userMessage?.role).toBe("user");
    expect(userMessage?.content).toBe("hola");
    expect(userMessage?.runId).toBe(result.runId);
    // Nothing streamed yet: the execution is waiting on the gate.
    expect(s.runEventStore.events).toHaveLength(0);

    gate.open();
    await expect(s.backgroundTasks.drain(1000)).resolves.toBe(true);
    expect(runOf(s, result.runId).status).toBe("succeeded");
  });

  // Cross-tenancy is proven against real rows in the adapters integration
  // suite (agent-runtime.test.ts): an in-memory double cannot carry the S4
  // evidence by itself.
  it("reuses a conversation of the workspace when given", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId } = await seedAgent(s, ws);
    const created = await s.conversationRepo.insert(ws, {
      id: s.idGen.newId(),
      agentId,
      title: "charla",
    });

    const result = await s.service.startRun(ws, USER, {
      agentId,
      conversationId: created.id,
      input: "otra vez",
    });
    await expect(s.backgroundTasks.drain(1000)).resolves.toBe(true);

    expect(result.conversationId).toBe(created.id);
    // No new conversation was opened for the run.
    expect(
      s.conversationRepo.rows.filter((row) => row.id === result.conversationId),
    ).toHaveLength(1);
    // The transcript the turn saw is the conversation's own history.
    const users = s.messageRepo.rows.filter((row) => row.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.conversationId).toBe(created.id);
    expect(runOf(s, result.runId).status).toBe("succeeded");
  });

  it("accepts `background: true` and still executes in-process", async () => {
    const s = createSetup();
    const { agentId } = await seedAgent(s, WORKSPACE_A);
    const result = await s.service.startRun(WORKSPACE_A, USER, {
      agentId,
      input: "hola",
      background: true,
    });
    await expect(s.backgroundTasks.drain(1000)).resolves.toBe(true);
    expect(runOf(s, result.runId).status).toBe("succeeded");
  });
});

describe("executeRun", () => {
  it("streams a happy path: run.started, grouped deltas, completed message, usage and succeeded", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("succeeded");
    expect(finished?.output).toBe("hola mundo");
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.leaseUntil).toBeNull();
    expect(eventTypesOf(s, runId)).toEqual([
      "run.started",
      "message.delta",
      "message.completed",
      "usage",
      "run.completed",
    ]);
    const [started, delta, completed, usage, done] = eventsOf(s, runId);
    expect(started).toMatchObject({
      type: "run.started",
      agentVersionId: versionId,
      model: "gpt-5",
    });
    // Both deltas landed in one window: exactly one stored event, whole text.
    expect(delta).toEqual({
      type: "message.delta",
      messageId: expect.any(String),
      text: "hola mundo",
    });
    expect(completed).toMatchObject({
      type: "message.completed",
      content: "hola mundo",
    });
    expect(usage).toEqual({
      type: "usage",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    });
    expect(done).toMatchObject({ type: "run.completed", output: "hola mundo" });
    // The dual write agrees: the bus carried the stored seqs (S4).
    expect(s.liveEventBus.published.map((row) => row.event)).toEqual(
      eventsOf(s, runId),
    );
    expect(s.liveEventBus.published.map((row) => row.seq)).toEqual(
      s.runEventStore.events.map((row) => row.seq),
    );
  });

  it("delivers exactly one delta event per flush, not one per token", async () => {
    const s = createSetup({
      runtime: scriptedRuntime([
        {
          deltas: ["a", "b", "c", "d", "e"],
          thinking: ["pens", "ando"],
        },
      ]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    await s.service.executeRun(ws, runId);

    // One flush per turn: a single append call carried both grouped events.
    const deltaAppends = s.runEventStore.appendCalls.filter((call) =>
      call.some((event) => event.type === "message.delta"),
    );
    expect(deltaAppends).toHaveLength(1);
    expect(deltaAppends[0]).toEqual([
      { type: "message.delta", messageId: expect.any(String), text: "abcde" },
      {
        type: "thinking.delta",
        messageId: expect.any(String),
        text: "pensando",
      },
    ]);
    const types = eventTypesOf(s, runId);
    expect(types.filter((type) => type === "message.delta")).toHaveLength(1);
    expect(types.filter((type) => type === "thinking.delta")).toHaveLength(1);
  });

  it("appends the assistant message and one usage record (S7)", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const conversation = await s.conversationRepo.insert(ws, {
      id: s.idGen.newId(),
      agentId,
      title: null,
    });
    await s.messageRepo.append(ws, {
      id: s.idGen.newId(),
      conversationId: conversation.id,
      runId: null,
      role: "user",
      content: "hola",
    });
    const runId = seedRun(s, {
      workspaceId: ws,
      agentId,
      versionId,
      conversationId: conversation.id,
    });

    await s.service.executeRun(ws, runId);

    const assistant = s.messageRepo.rows.find(
      (row) => row.role === "assistant",
    );
    expect(assistant?.content).toBe("hola mundo");
    expect(assistant?.runId).toBe(runId);
    expect(s.usageRepo.records).toHaveLength(1);
    expect(s.usageRepo.records[0]).toEqual({
      runId,
      agentId,
      providerId: "openai",
      modelId: "gpt-5",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    });
  });

  it("persists the checkpoint and the turn count after each turn (S5)", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    await s.service.executeRun(ws, runId);

    const run = runOf(s, runId);
    expect(run.turnsCompleted).toBe(1);
    expect(run.checkpoint).toEqual({
      transcript: [
        { role: "user", text: "hola" },
        { role: "assistant", text: "hola mundo" },
      ],
    });
  });

  it("does nothing on a live lease held by another process (§5)", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, {
      workspaceId: ws,
      agentId,
      versionId,
      status: "running",
      leaseUntil: new Date(BASE_TIME.getTime() + 60_000),
    });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished).toBeNull();
    expect(s.runEventStore.events).toHaveLength(0);
    expect(s.runRepo.renewals.count).toBe(0);
    expect(runOf(s, runId).status).toBe("running");
  });

  it("fails with the runtime's provider code and never emits run.completed", async () => {
    const s = createSetup({
      runtime: scriptedRuntime([
        { deltas: ["parcial"], error: "invalid_api_key" },
      ]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("failed");
    expect(finished?.errorCode).toBe("invalid_api_key");
    expect(eventTypesOf(s, runId)).toEqual([
      "run.started",
      "message.delta",
      "run.failed",
    ]);
    const failure = eventsOf(s, runId).at(-1);
    expect(failure).toEqual({
      type: "run.failed",
      code: "invalid_api_key",
      message: "invalid_api_key",
    });
    expect(s.usageRepo.records).toHaveLength(0);
    expect(s.messageRepo.rows.some((row) => row.role === "assistant")).toBe(
      false,
    );
  });

  it("never lets the api key appear in a stored event (S12)", async () => {
    const s = createSetup({
      runtime: scriptedRuntime([{ error: "invalid_api_key" }]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    await s.service.executeRun(ws, runId);

    expect(JSON.stringify(s.runEventStore.events)).not.toContain(API_KEY);
    expect(JSON.stringify(s.liveEventBus.published)).not.toContain(API_KEY);
  });

  it("finishes limit_reached when the 25-turn ceiling is already spent", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, {
      workspaceId: ws,
      agentId,
      versionId,
      turnsCompleted: DEFAULT_RUN_LIMITS.maxTurns,
    });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("failed");
    expect(finished?.errorCode).toBe("limit_reached");
    expect(eventTypesOf(s, runId)).toEqual(["run.started", "run.failed"]);
  });

  it("finishes run_timeout when the interactive deadline has passed", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, {
      workspaceId: ws,
      agentId,
      versionId,
      startedAt: new Date(BASE_TIME.getTime() - 11 * 60 * 1000),
    });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("failed");
    expect(finished?.errorCode).toBe("run_timeout");
    expect(eventTypesOf(s, runId)).toEqual(["run.started", "run.failed"]);
  });

  it("finishes cancelled when the run was marked cancelled mid-flight", async () => {
    const gate = deferred();
    const s = createSetup({
      runtime: scriptedRuntime([{ deltas: ["hola"], gate: gate.promise }]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    const execution = s.service.executeRun(ws, runId);
    // Wait until the executor is inside the turn, then cancel the way the
    // cancel endpoint will: a terminal write on the run row.
    await vi.waitFor(() => {
      expect(s.runEventStore.events.length).toBeGreaterThan(0);
    });
    const cancelled = await s.runRepo.finish(ws, runId, {
      status: "cancelled",
      output: null,
    });
    expect(cancelled?.status).toBe("cancelled");
    gate.open();
    const finished = await execution;

    expect(finished?.status).toBe("cancelled");
    // Cancellation is observed at the turn boundary: the turn already in
    // flight completes (its events are kept), then the run closes cancelled.
    expect(eventTypesOf(s, runId)).toEqual([
      "run.started",
      "message.delta",
      "message.completed",
      "usage",
      "run.cancelled",
    ]);
    expect(finished?.leaseUntil).toBeNull();
  });

  it("renews the lease while running and releases it at the end (§5)", async () => {
    const s = createSetup({
      limits: testLimits({ leaseRenewalMs: 10, leaseDurationMs: 1_000 }),
      runtime: scriptedRuntime([{ deltas: ["hola"], delayMs: 50 }]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("succeeded");
    expect(s.runRepo.renewals.count).toBeGreaterThanOrEqual(2);
    expect(finished?.leaseUntil).toBeNull();
  });

  it("finishes failed with `unknown` instead of throwing when the runtime crashes", async () => {
    const s = createSetup({
      runtime: scriptedRuntime([
        { deltas: ["hola"], crash: new Error("boom") },
      ]),
    });
    const ws = WORKSPACE_A;
    const { agentId, versionId } = await seedAgent(s, ws);
    const runId = seedRun(s, { workspaceId: ws, agentId, versionId });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("failed");
    expect(finished?.errorCode).toBe("unknown");
    expect(eventTypesOf(s, runId)).toEqual(["run.started", "run.failed"]);
  });

  it("reports a missing agent version as a failed run, not a throw", async () => {
    const s = createSetup();
    const ws = WORKSPACE_A;
    const { agentId } = await seedAgent(s, ws);
    const runId = seedRun(s, {
      workspaceId: ws,
      agentId,
      versionId: s.idGen.newId(),
    });

    const finished = await s.service.executeRun(ws, runId);

    expect(finished?.status).toBe("failed");
    expect(finished?.errorCode).toBe("unknown");
  });
});
