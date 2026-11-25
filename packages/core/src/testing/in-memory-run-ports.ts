import type { RunEvent } from "@middleware/contracts";

import type {
  Run,
  RunDraft,
  RunListFilter,
  RunOutcome,
  RunProgress,
} from "../domain/run.ts";
import type { BackgroundTasks } from "../ports/background-tasks.ts";
import type { Clock } from "../ports/clock.ts";
import type {
  LiveEventBus,
  LiveEventListener,
  LiveRunEvent,
} from "../ports/live-event-bus.ts";
import type {
  RunEventStore,
  StoredRunEvent,
} from "../ports/run-event-store.ts";
import type { RunRepo } from "../ports/run-repo.ts";

/**
 * In-memory run ports honouring each port contract, so `runs.ts` is
 * unit-testable without a database. The shapes mirror the Postgres adapters,
 * including the lease predicates: the run engine's coordination semantics are
 * part of the contract, not of the database.
 */

/** Statuses a lease holder can still move (same predicate as the adapter). */
const RESUMABLE: readonly Run["status"][] = [
  "queued",
  "running",
  "waiting_approval",
];

const isResumable = (run: Run | undefined): run is Run =>
  run !== undefined && RESUMABLE.includes(run.status);

export type InMemoryRunRepo = RunRepo & {
  /** The stored rows; tests may edit them to seed states (a seed helper). */
  runs: Run[];
  /** Renewals that actually extended a lease (the contract's observable). */
  renewals: { count: number };
};

/**
 * The fake takes the same clock the use case gets, because the lease
 * comparison needs "now" and the Postgres adapter takes it from the database.
 */
export function createInMemoryRunRepo(
  clock: Clock = { now: () => new Date() },
): InMemoryRunRepo {
  const runs: Run[] = [];
  const renewals = { count: 0 };
  const find = (workspaceId: string, runId: string) =>
    runs.find((run) => run.workspaceId === workspaceId && run.id === runId);

  return {
    runs,
    renewals,

    async insert(workspaceId, draft: RunDraft) {
      const run: Run = {
        id: draft.id,
        workspaceId,
        agentId: draft.agentId,
        agentVersionId: draft.agentVersionId,
        conversationId: draft.conversationId,
        status: "queued",
        input: draft.input,
        output: null,
        errorCode: null,
        errorMessage: null,
        turnsCompleted: 0,
        checkpoint: null,
        leaseUntil: null,
        queuedAt: new Date(0),
        startedAt: null,
        finishedAt: null,
      };
      runs.push(run);
      return { ...run };
    },

    async findById(workspaceId, runId) {
      const run = find(workspaceId, runId);
      return run ? { ...run } : null;
    },

    async claimLease(workspaceId, runId, leaseUntil) {
      const run = find(workspaceId, runId);
      // The lease predicate is the whole contract: absent or already expired
      // wins, a live lease loses; claiming marks the run running and stamps
      // `startedAt` on the first claim.
      if (!isResumable(run)) return false;
      const now = clock.now();
      if (run.leaseUntil !== null && run.leaseUntil > now) return false;
      run.status = "running";
      run.leaseUntil = leaseUntil;
      run.startedAt ??= now;
      return true;
    },

    async renewLease(workspaceId, runId, leaseUntil) {
      const run = find(workspaceId, runId);
      if (!isResumable(run)) return null;
      run.leaseUntil = leaseUntil;
      renewals.count += 1;
      return { ...run };
    },

    async saveProgress(workspaceId, runId, progress: RunProgress) {
      const run = find(workspaceId, runId);
      if (!isResumable(run)) return null;
      run.checkpoint = progress.checkpoint;
      run.turnsCompleted = progress.turnsCompleted;
      return { ...run };
    },

    async finish(workspaceId, runId, outcome: RunOutcome) {
      const run = find(workspaceId, runId);
      if (!run) return null;
      run.status = outcome.status;
      run.output = "output" in outcome ? outcome.output : null;
      run.errorCode = "errorCode" in outcome ? outcome.errorCode : null;
      run.errorMessage =
        "errorMessage" in outcome ? outcome.errorMessage : null;
      run.finishedAt = clock.now();
      // Terminal: the lease dies with the run.
      run.leaseUntil = null;
      return { ...run };
    },

    async listByWorkspace(workspaceId, filter: RunListFilter) {
      return runs
        .filter(
          (run) =>
            run.workspaceId === workspaceId &&
            (filter.status === undefined || run.status === filter.status),
        )
        .sort(
          (left, right) => right.queuedAt.getTime() - left.queuedAt.getTime(),
        )
        .slice(0, filter.limit ?? 100)
        .map((run) => ({ ...run }));
    },
  };
}

/** A stored event that remembers its run, so tests can inspect per run. */
type InMemoryStoredRunEvent = StoredRunEvent & {
  runId: string;
  workspaceId: string;
};

export type InMemoryRunEventStore = RunEventStore & {
  /** Every stored row, in append order, with its run and workspace. */
  events: InMemoryStoredRunEvent[];
  /** One entry per `append` call, with the events it carried. */
  appendCalls: RunEvent[][];
};

export function createInMemoryRunEventStore(): InMemoryRunEventStore {
  const events: InMemoryStoredRunEvent[] = [];
  const appendCalls: RunEvent[][] = [];
  const nextSeq = new Map<string, number>();

  return {
    events,
    appendCalls,

    async append(workspaceId, runId, batch) {
      appendCalls.push([...batch]);
      let seq = nextSeq.get(runId) ?? 0;
      const stored: InMemoryStoredRunEvent[] = batch.map((event) => {
        seq += 1;
        return {
          seq,
          event,
          createdAt: new Date(0),
          runId,
          workspaceId,
        };
      });
      events.push(...stored);
      nextSeq.set(runId, seq);
      return stored.map(({ seq: storedSeq, event, createdAt }) => ({
        seq: storedSeq,
        event,
        createdAt,
      }));
    },

    async listAfter(workspaceId, runId, afterSeq, limit = 100) {
      return events
        .filter(
          (row) =>
            row.workspaceId === workspaceId &&
            row.runId === runId &&
            row.seq > afterSeq,
        )
        .slice(0, limit)
        .map(({ seq, event, createdAt }) => ({ seq, event, createdAt }));
    },
  };
}

export type InMemoryLiveEventBus = LiveEventBus & {
  /** Every published message, with the run it went to. */
  published: (LiveRunEvent & { runId: string })[];
};

export function createInMemoryLiveEventBus(): InMemoryLiveEventBus {
  const listeners = new Map<string, Set<LiveEventListener>>();
  const published: (LiveRunEvent & { runId: string })[] = [];

  return {
    published,

    publish(runId, message: LiveRunEvent) {
      published.push({ ...message, runId });
      for (const listener of listeners.get(runId) ?? []) {
        listener(message);
      }
    },

    subscribe(runId, listener: LiveEventListener) {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);
      return () => {
        listeners.get(runId)?.delete(listener);
      };
    },
  };
}

export type InMemoryBackgroundTasks = BackgroundTasks & {
  /** The registered task promises, in start order. */
  tasks: Promise<void>[];
};

export function createInMemoryBackgroundTasks(): InMemoryBackgroundTasks {
  const pending = new Set<Promise<void>>();
  const tasks: Promise<void>[] = [];

  return {
    tasks,

    track(task: () => Promise<void>) {
      const running = task();
      const registered = running.finally(() => {
        pending.delete(registered);
      });
      pending.add(registered);
      tasks.push(registered);
      // The registry observes the registered promise, so a fire-and-forget
      // task never becomes an unhandled rejection.
      void registered.catch(() => {});
      return running;
    },

    async drain(timeoutMs: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      try {
        const settled = Promise.allSettled([...pending]).then(
          () => "done" as const,
        );
        return (await Promise.race([settled, timeout])) === "done";
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
