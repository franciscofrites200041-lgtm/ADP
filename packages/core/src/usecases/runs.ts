import type {
  AgentParams,
  CreateRunRequest,
  ProviderErrorCode,
  RunCheckpoint,
  RunEvent,
} from "@middleware/contracts";
import { agentParamsSchema } from "@middleware/contracts";
import type { Message } from "../domain/conversation.ts";
import { DomainError, NotFoundError } from "../domain/errors.ts";
import type { Run, RunDraft, RunOutcome, RunProgress } from "../domain/run.ts";
import type { AgentRepo } from "../ports/agent-repo.ts";
import type {
  AgentRuntime,
  RuntimeMessage,
  RuntimeUsage,
} from "../ports/agent-runtime.ts";
import type { BackgroundTasks } from "../ports/background-tasks.ts";
import type { Clock } from "../ports/clock.ts";
import type { ConversationRepo } from "../ports/conversation-repo.ts";
import type { CredentialRepo } from "../ports/credential-repo.ts";
import type { IdGen } from "../ports/id-gen.ts";
import type { LiveEventBus } from "../ports/live-event-bus.ts";
import type { MessageRepo } from "../ports/message-repo.ts";
import type { ModelTarget } from "../ports/model-gateway.ts";
import type { RunEventStore } from "../ports/run-event-store.ts";
import type { RunRepo } from "../ports/run-repo.ts";
import type { SecretVault } from "../ports/secret-vault.ts";
import type { UsageRepo } from "../ports/usage-repo.ts";

/**
 * The §5 limits of an interactive chat run. `leaseRenewalMs` and
 * `leaseDurationMs` are the liveness lease: renewed every 30 s, valid for 90 s
 * so two missed renewals never hand the run to another process. Tests inject
 * the whole object to make timers and limits observable.
 */
export type RunLimits = {
  maxTurns: number;
  timeoutMs: number;
  leaseRenewalMs: number;
  leaseDurationMs: number;
  deltaFlushMs: number;
  /** §10, S10: at most this many of a workspace's runs may be unfinished. */
  maxSimultaneousRuns: number;
};

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxTurns: 25,
  timeoutMs: 10 * 60 * 1000,
  leaseRenewalMs: 30_000,
  leaseDurationMs: 90_000,
  deltaFlushMs: 250,
  maxSimultaneousRuns: 5,
};

/**
 * A workspace at its §10 cap of simultaneous runs (S10). A quota, so it is
 * the caller's mistake: the route renders it by `code` like any other
 * rejected request. `message` stays internal and never reaches a client.
 */
export class RunConcurrencyLimitError extends DomainError {
  constructor(limit: number) {
    super("forbidden", `run_concurrency_limit:${limit}`);
    this.name = "RunConcurrencyLimitError";
  }
}

/** Table of the sealed credential the secret vault opens (S3). */
const CREDENTIAL_TABLE = "provider_credential";

export type RunServiceDeps = {
  agentRepo: AgentRepo;
  credentialRepo: CredentialRepo;
  conversationRepo: ConversationRepo;
  messageRepo: MessageRepo;
  runRepo: RunRepo;
  runEventStore: RunEventStore;
  liveEventBus: LiveEventBus;
  backgroundTasks: BackgroundTasks;
  agentRuntime: AgentRuntime;
  secretVault: SecretVault;
  usageRepo: UsageRepo;
  clock: Clock;
  idGen: IdGen;
  /** Overrides of the §5 defaults; unset means the interactive defaults. */
  limits?: RunLimits;
};

export type StartRunResult = { runId: string; conversationId: string };

export type RunService = {
  /**
   * Validates the agent, persists the queued run with its user message and
   * hands the execution to `BackgroundTasks`: the caller gets the ids
   * immediately and the run keeps going if the client disconnects (§5).
   */
  startRun(
    workspaceId: string,
    actorUserId: string,
    input: CreateRunRequest,
  ): Promise<StartRunResult>;
  /**
   * Runs one claimed execution to a terminal state and returns the finished
   * run, or `null` when another process holds the lease or the run is gone.
   * Never throws: every failure is a finished run.
   */
  executeRun(workspaceId: string, runId: string): Promise<Run | null>;
};

/** What one streamed turn resolved to: a reply with its usage, or a failure. */
type TurnResult =
  | { kind: "done"; output: string; usage: RuntimeUsage }
  | { kind: "error"; code: ProviderErrorCode };

/** Marker that the deadline won the race against the stream (§5). */
class TurnDeadline {}

/** A deadline timer the turn loop races the stream against (§5). */
function deadlineTimer(ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<TurnDeadline>((resolve) => {
    timer = setTimeout(() => resolve(new TurnDeadline()), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

export function createRunService(deps: RunServiceDeps): RunService {
  const {
    agentRepo,
    credentialRepo,
    conversationRepo,
    messageRepo,
    runRepo,
    runEventStore,
    liveEventBus,
    backgroundTasks,
    agentRuntime,
    secretVault,
    usageRepo,
    clock,
    idGen,
  } = deps;
  const limits = deps.limits ?? DEFAULT_RUN_LIMITS;

  const leaseUntil = () =>
    new Date(clock.now().getTime() + limits.leaseDurationMs);

  /**
   * One event, two destinations (S4): the durable half first — the store
   * assigns the `seq` — then the live fan-out with exactly that sequence
   * number, so a reconnecting client and the live stream agree.
   */
  const emit = async (
    workspaceId: string,
    runId: string,
    events: readonly RunEvent[],
  ): Promise<void> => {
    const stored = await runEventStore.append(workspaceId, runId, events);
    for (const row of stored) {
      liveEventBus.publish(runId, { seq: row.seq, event: row.event });
    }
  };

  /**
   * INVARIANT (S6): the terminal event (`run.completed` / `run.failed` /
   * `run.cancelled`) is durable in the event store BEFORE the run row's
   * status flips. A reader that sees the row read terminal can then replay
   * the run to its end without ever waiting for an event that is still
   * coming. Every engine terminal write goes through here — nothing else in
   * the engine may call `runRepo.finish`.
   */
  const finishTerminal = async (
    run: Run,
    events: readonly RunEvent[],
    outcome: RunOutcome,
  ): Promise<Run | null> => {
    await emit(run.workspaceId, run.id, events);
    const finished = await runRepo.finish(run.workspaceId, run.id, outcome);
    if (finished) return finished;
    // The port refuses to overwrite a terminal row (S11): another writer —
    // a canceller, or the process that closed the run after a fault — got
    // there first. Report the row that actually won, never a silent `null`.
    return await runRepo.findById(run.workspaceId, run.id);
  };

  /**
   * The provider failed and the run ends `failed`. The event carries the code
   * only: the Spanish wording lives in the messages file of the layer that
   * renders it (WP-33), and the provider's raw text never does (S2, §8).
   */
  const finishFailed = async (
    run: Run,
    code: ProviderErrorCode,
  ): Promise<Run | null> =>
    await finishTerminal(run, [{ type: "run.failed", code, message: code }], {
      status: "failed",
      errorCode: code,
      errorMessage: code,
    });

  /**
   * The engine never throws: an unexpected failure (a broken port, an
   * interrupted write) is a finished run. Best effort, because the same fault
   * may break the closing writes too; then the lease expiry hands the row
   * back to the tick (§5).
   */
  const finishUnexpectedly = async (
    workspaceId: string,
    runId: string,
  ): Promise<Run | null> => {
    try {
      // The same S6 invariant as every terminal path: the terminal event is
      // durable before the row's status flips — even on the best-effort
      // path, where the fault may be the store itself.
      await emit(workspaceId, runId, [
        { type: "run.failed", code: "unknown", message: "unknown" },
      ]);
    } catch {
      // The event store is as broken as whatever threw; the run row below
      // still gets closed.
    }
    try {
      const finished = await runRepo.finish(workspaceId, runId, {
        status: "failed",
        errorCode: "unknown",
        errorMessage: "unknown",
      });
      if (finished) return finished;
      return await runRepo.findById(workspaceId, runId);
    } catch {
      return null;
    }
  };

  /**
   * A stored message → a transcript message. `tool_result` rows have no
   * transcript shape yet: the domain `Message` carries no tool ids, so WP-40
   * extends this mapping when tool calls land in the conversation.
   */
  const toTranscriptMessage = (message: Message): RuntimeMessage[] => {
    switch (message.role) {
      case "user":
        return [{ role: "user", text: message.content }];
      case "assistant":
        return [{ role: "assistant", text: message.content }];
      case "tool_result":
        return [];
    }
  };

  /** History ascending by creation (§10), paged until the cursor runs out. */
  const loadTranscript = async (run: Run): Promise<RuntimeMessage[]> => {
    if (run.conversationId === null) {
      // A run without a conversation carries its own input as the prompt.
      return [{ role: "user", text: run.input }];
    }
    const messages: Message[] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await messageRepo.listByConversation(
        run.workspaceId,
        run.conversationId,
        cursor === null ? {} : { after: cursor },
      );
      messages.push(...page.messages);
      // An empty page with a cursor would loop forever; nothing more to read.
      if (page.nextCursor === null || page.messages.length === 0) break;
      cursor = page.nextCursor;
    }
    return messages.flatMap(toTranscriptMessage);
  };

  const driveRun = async (run: Run): Promise<Run | null> => {
    const { workspaceId, id: runId } = run;

    // The version this run pinned at start, and its credential with the key
    // opened only here, in memory, for this run (S3): the key is never
    // logged, never returned and never put into an event (S12).
    const version = await agentRepo.findVersion(
      workspaceId,
      run.agentId,
      run.agentVersionId,
    );
    if (!version) return await finishFailed(run, "unknown");
    // The version's model params are a contract shape (S3): a row that does
    // not honour it fails the run loudly instead of running on silent
    // defaults — or on whatever the provider does with a rogue value.
    const parsedParams = agentParamsSchema.safeParse(version.params);
    if (!parsedParams.success) return await finishFailed(run, "unknown");
    const stored =
      version.credentialId === null
        ? null
        : await credentialRepo.findSealed(workspaceId, version.credentialId);
    if (!stored) return await finishFailed(run, "unknown");
    const apiKey = await secretVault.open(
      workspaceId,
      { table: CREDENTIAL_TABLE, id: stored.id },
      stored.secret,
    );
    const model: ModelTarget = {
      providerId: version.providerId,
      modelId: version.modelId,
      credential: {
        apiKey,
        ...(stored.baseUrl === null ? {} : { baseUrl: stored.baseUrl }),
      },
    };

    const transcript = await loadTranscript(run);
    let turns = run.turnsCompleted;
    let lastOutput: string | null = null;
    const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    // The deadline is the run's `startedAt` (stamped by the claim) plus the
    // interactive limit; a resumed run keeps the original one (§5).
    const deadlineMs =
      (run.startedAt?.getTime() ?? clock.now().getTime()) + limits.timeoutMs;
    const timeLeftMs = () => deadlineMs - clock.now().getTime();

    // Delta buffers (S4): `message.delta` rows are grouped per 250 ms window,
    // one row per assistant message and one per thinking stream.
    const delta = { messageId: null as string | null, text: "" };
    const thinking = { messageId: null as string | null, text: "" };
    const takeDeltaEvents = (): RunEvent[] => {
      const events: RunEvent[] = [];
      if (delta.messageId !== null && delta.text !== "") {
        events.push({
          type: "message.delta",
          messageId: delta.messageId,
          text: delta.text,
        });
      }
      delta.messageId = null;
      delta.text = "";
      if (thinking.messageId !== null && thinking.text !== "") {
        events.push({
          type: "thinking.delta",
          messageId: thinking.messageId,
          text: thinking.text,
        });
      }
      thinking.messageId = null;
      thinking.text = "";
      return events;
    };
    // Flushes are serialized: the timer and the turn boundary must not inter
    // two `append` batches out of order.
    let flushChain: Promise<void> = Promise.resolve();
    const flushDeltas = (): Promise<void> => {
      const flushing = flushChain.then(async () => {
        const events = takeDeltaEvents();
        if (events.length > 0) await emit(workspaceId, runId, events);
      });
      // Keep the chain alive for the next flush; the caller observes errors.
      flushChain = flushing.catch(() => undefined);
      return flushing;
    };

    // The two wall-clock timers of a live run: the lease renewal (§5) and the
    // delta flush (S4). Both stop when the run leaves the loop, whatever the
    // exit path.
    const renewTimer = setInterval(() => {
      void runRepo
        .renewLease(workspaceId, runId, leaseUntil())
        // A failed renewal surfaces on the next one, or when the lease
        // expires and the tick re-enqueues the run; it never kills the run.
        .catch(() => undefined);
    }, limits.leaseRenewalMs);
    const flushTimer = setInterval(() => {
      // A failed timer flush resurfaces at the turn-end flush, which the
      // loop awaits: the run finishes failed instead of hanging.
      void flushDeltas().catch(() => undefined);
    }, limits.deltaFlushMs);

    /**
     * One streamed turn. The engine races the stream against the deadline:
     * a turn that outlasts it is abandoned, which aborts the provider call
     * inside the runtime adapter, and the run finishes `run_timeout`.
     */
    const runTurn = async (turnInput: {
      model: ModelTarget;
      systemPrompt: string;
      messages: readonly RuntimeMessage[];
      params: AgentParams;
      messageId: string;
      deadlineMs: number;
    }): Promise<TurnResult> => {
      const events = agentRuntime.streamTurn({
        model: turnInput.model,
        systemPrompt: turnInput.systemPrompt,
        messages: turnInput.messages,
        // The agent version's own params (S3): temperature and whatever else
        // the contract allows reach the provider request through the port.
        params: turnInput.params,
      });
      const iterator = events[Symbol.asyncIterator]();
      const timeout = deadlineTimer(turnInput.deadlineMs);
      let turnUsage: RuntimeUsage | undefined;
      try {
        while (true) {
          const step = await Promise.race([iterator.next(), timeout.promise]);
          if (step instanceof TurnDeadline) {
            // The deadline passed mid-turn: abandon the stream (the adapter
            // aborts the provider call) and let the run finish `failed`.
            await iterator.return?.(undefined);
            return { kind: "error", code: "run_timeout" };
          }
          if (step.done) {
            // The stream closed without a terminal event: not a reply.
            return { kind: "error", code: "unknown" };
          }
          const event = step.value;
          switch (event.type) {
            case "text":
              delta.messageId ??= turnInput.messageId;
              delta.text += event.text;
              break;
            case "thinking":
              thinking.messageId ??= turnInput.messageId;
              thinking.text += event.text;
              break;
            case "usage":
              turnUsage = {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                costUsd: event.costUsd,
              };
              break;
            case "done":
              return {
                kind: "done",
                output: event.output,
                usage: turnUsage ?? event.usage,
              };
            case "error":
              return { kind: "error", code: event.code };
          }
        }
      } finally {
        timeout.clear();
        // Close the stream on every exit: after `done`/`error` this is a
        // no-op that lets the adapter settle its agent run.
        await iterator.return?.(undefined);
      }
    };

    try {
      await emit(workspaceId, runId, [
        {
          type: "run.started",
          runId,
          agentVersionId: version.id,
          model: version.modelId,
        },
      ]);

      while (true) {
        // Cancellation is checked at turn boundaries: a canceller marks the
        // row terminal through `finish`, and the next boundary sees it (S11).
        const current = await runRepo.findById(workspaceId, runId);
        if (current?.status === "cancelled") {
          await flushDeltas();
          // The S6 invariant: the terminal event first, the row flip after.
          return await finishTerminal(run, [{ type: "run.cancelled" }], {
            status: "cancelled",
            output: lastOutput,
          });
        }
        // The loop keeps turning only while there is a prompt to answer:
        // after a turn the transcript ends with the assistant reply, and a
        // `tool_result` tail (WP-40) is what would keep it going.
        const prompt = transcript.at(-1);
        if (prompt === undefined || prompt.role === "assistant") break;
        // §5 limits: no turn beyond the 25th, nothing after the deadline.
        if (turns + 1 > limits.maxTurns) {
          await flushDeltas();
          return await finishFailed(run, "limit_reached");
        }
        if (timeLeftMs() <= 0) {
          await flushDeltas();
          return await finishFailed(run, "run_timeout");
        }

        const messageId = idGen.newId();
        const turn = await runTurn({
          model,
          systemPrompt: version.instructions,
          messages: transcript,
          params: parsedParams.data,
          messageId,
          deadlineMs: timeLeftMs(),
        });
        if (turn.kind === "error") {
          await flushDeltas();
          return await finishFailed(run, turn.code);
        }

        // Turn complete (S4, S5, S7): the pending deltas close before the
        // completed message, the usage row goes with the assistant message,
        // and the checkpoint persists what a resume (WP-50) needs.
        await flushDeltas();
        if (run.conversationId !== null) {
          await messageRepo.append(workspaceId, {
            id: messageId,
            conversationId: run.conversationId,
            runId,
            role: "assistant",
            content: turn.output,
          });
        }
        await emit(workspaceId, runId, [
          { type: "message.completed", messageId, content: turn.output },
        ]);
        totals.inputTokens += turn.usage.inputTokens;
        totals.outputTokens += turn.usage.outputTokens;
        totals.costUsd += turn.usage.costUsd;
        await usageRepo.insert(workspaceId, {
          runId,
          agentId: run.agentId,
          providerId: version.providerId,
          modelId: version.modelId,
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          // The runtime's usage carries no cache split yet (WP-40); the row
          // records the totals it does report.
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: turn.usage.costUsd,
        });
        await emit(workspaceId, runId, [
          {
            type: "usage",
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            costUsd: totals.costUsd,
          },
        ]);
        transcript.push({ role: "assistant", text: turn.output });
        turns += 1;
        lastOutput = turn.output;
        // The checkpoint is the contract shape a resume reads (WP-50): the
        // transcript so far; the turn count lives in its own column.
        // Deferred to WP-50, deliberately: the read side of this shape — the
        // recovery that re-enqueues a run and replays from its checkpoint —
        // is not built yet. Until it lands, a re-claimed run restarts from
        // the conversation transcript in the message store, and `checkpoint`
        // is written but never read.
        const checkpoint: RunCheckpoint = { transcript: [...transcript] };
        const progress: RunProgress = {
          checkpoint,
          turnsCompleted: turns,
        };
        await runRepo.saveProgress(workspaceId, runId, progress);
      }

      // A run without assistant text is never a success with an empty
      // output: an empty transcript (nothing to answer) or an empty reply
      // means the turn pipeline produced nothing, and the run says so (§5).
      if (!lastOutput) return await finishFailed(run, "unknown");
      // The S6 invariant: the terminal event first, the row flip after.
      return await finishTerminal(
        run,
        [
          {
            type: "run.completed",
            output: lastOutput,
            finishedAt: clock.now().toISOString(),
          },
        ],
        { status: "succeeded", output: lastOutput },
      );
    } finally {
      // Stop renewing and flushing: the run has left the loop (§5).
      clearInterval(renewTimer);
      clearInterval(flushTimer);
    }
  };

  const executeRun = async (
    workspaceId: string,
    runId: string,
  ): Promise<Run | null> => {
    try {
      const existing = await runRepo.findById(workspaceId, runId);
      if (!existing) return null;
      // Another process owns the run while its lease is live: the claim is
      // the whole coordination, and a lost claim does nothing (§5).
      const claimed = await runRepo.claimLease(
        workspaceId,
        runId,
        leaseUntil(),
      );
      if (!claimed) return null;
      const run = await runRepo.findById(workspaceId, runId);
      if (!run) return null;
      return await driveRun(run);
    } catch {
      return await finishUnexpectedly(workspaceId, runId);
    }
  };

  const startRun = async (
    workspaceId: string,
    // The actor is not persisted yet: neither `run` nor `message` carries an
    // author column (§7). It stays in the signature for the audit trail.
    _actorUserId: string,
    input: CreateRunRequest,
  ): Promise<StartRunResult> => {
    // Authorise first: the agent and its current version must exist in this
    // workspace, and a foreign id reads as missing (S4).
    const agent = await agentRepo.findById(workspaceId, input.agentId);
    if (!agent) throw new NotFoundError();
    const version = await agentRepo.currentVersion(workspaceId, input.agentId);
    if (!version) throw new NotFoundError("version_not_found");

    // Reuse the conversation when given (it must belong to this workspace, so
    // a foreign id reads as missing, S4); otherwise open one for the agent.
    let conversationId: string;
    if (input.conversationId === undefined) {
      const created = await conversationRepo.insert(workspaceId, {
        id: idGen.newId(),
        agentId: input.agentId,
        title: null,
      });
      conversationId = created.id;
    } else {
      const conversation = await conversationRepo.findById(
        workspaceId,
        input.conversationId,
      );
      if (!conversation) throw new NotFoundError("conversation_not_found");
      conversationId = conversation.id;
    }

    // The run row pins the current version, so a later edit never rewrites
    // what an execution runs (S3). The §10 cap (S10) is enforced inside the
    // same unit as the insert: the workspace's unfinished runs are counted
    // there, a racing pair of starts cannot both pass, and a workspace at
    // the cap gets a typed refusal. A refused start may leave the
    // conversation it just opened: the cap counts unfinished runs, so the
    // check must be atomic with the run's insert, and an empty conversation
    // is harmless.
    const runId = idGen.newId();
    const draft: RunDraft = {
      id: runId,
      workspaceId,
      agentId: input.agentId,
      agentVersionId: version.id,
      conversationId,
      trigger: "chat",
      input: input.input,
    };
    const inserted = await runRepo.insertWithinLimit(
      workspaceId,
      draft,
      limits.maxSimultaneousRuns,
    );
    if (!inserted)
      throw new RunConcurrencyLimitError(limits.maxSimultaneousRuns);
    await messageRepo.append(workspaceId, {
      id: idGen.newId(),
      conversationId,
      runId,
      role: "user",
      content: input.input,
    });

    // WP-50 brings the pg-boss queue. A `background: true` request is
    // accepted here, but the execution still runs in this process, inside
    // `BackgroundTasks`, so it survives the client disconnecting (§5).
    void backgroundTasks.track(async () => {
      await executeRun(workspaceId, runId);
    });

    return { runId, conversationId };
  };

  return { startRun, executeRun };
}
