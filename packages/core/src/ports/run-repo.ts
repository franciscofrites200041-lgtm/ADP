import type {
  Run,
  RunDraft,
  RunListFilter,
  RunOutcome,
  RunProgress,
} from "../domain/run.ts";

/**
 * Every method scopes by `workspaceId` first (S4): the id always comes from
 * the session, never from the request, so another workspace's run reads as
 * missing. The one exception is `listExpiredLeases`, documented there.
 */
export type RunRepo = {
  /** Inserts a root run in `queued`; the draft's `id` is caller-generated. */
  insert(workspaceId: string, draft: RunDraft): Promise<Run>;
  findById(workspaceId: string, runId: string): Promise<Run | null>;
  /**
   * Takes the liveness lease so two processes never run one execution (§5):
   * it succeeds only when the current lease is absent or already expired,
   * and returns `false` when another holder is still live. Claiming also
   * marks the run `running` and stamps `startedAt` on the first claim.
   */
  claimLease(
    workspaceId: string,
    runId: string,
    leaseUntil: Date,
  ): Promise<boolean>;
  /** Extends the lease unconditionally; only the holder calls it (§5). */
  renewLease(
    workspaceId: string,
    runId: string,
    leaseUntil: Date,
  ): Promise<Run | null>;
  /** Persists the checkpoint and the turn count of the last turn (S5). */
  saveProgress(
    workspaceId: string,
    runId: string,
    progress: RunProgress,
  ): Promise<Run | null>;
  /** Records a terminal state, stamps `finishedAt` and releases the lease. */
  finish(
    workspaceId: string,
    runId: string,
    outcome: RunOutcome,
  ): Promise<Run | null>;
  /** Newest first (`queuedAt` desc). */
  listByWorkspace(workspaceId: string, filter: RunListFilter): Promise<Run[]>;
  /**
   * Runs stuck in `running` whose lease expired: the orphans the tick
   * re-enqueues with `run.resume` (§5). No workspace filter on purpose: the
   * tick is a system sweep over the whole table, not a user request, and
   * each row carries the `workspaceId` the re-enqueue needs. There is no
   * session here to scope by, so scoping would be impossible to satisfy.
   */
  listExpiredLeases(now: Date): Promise<Run[]>;
};
