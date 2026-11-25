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
 * missing. There is no workspace-less exception here: the system-wide sweep
 * of expired leases is the separate `RunSweeper` port (ADR-0007).
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
  /**
   * Records a terminal state, stamps `finishedAt` and releases the lease.
   * Conditional (S11): a row that already reads terminal is never
   * overwritten by a later, different terminal state — the call changes
   * nothing and returns `null`, so the caller can tell it lost the write
   * (a canceller got there first, or another process closed the run).
   */
  finish(
    workspaceId: string,
    runId: string,
    outcome: RunOutcome,
  ): Promise<Run | null>;
  /**
   * Inserts a root run in `queued` only while the workspace is under its cap
   * of simultaneous runs (§10, S10): the count of the workspace's unfinished
   * runs and the insert are one atomic unit, so a racing pair of starts
   * cannot both pass. Unfinished — not just `running` — is what counts: a
   * queued run is about to run, and counting only `running` would let a
   * racing pair through. Returns `null` when the workspace is at the cap;
   * the caller renders that as a typed refusal, never as a missing resource.
   */
  insertWithinLimit(
    workspaceId: string,
    draft: RunDraft,
    maxSimultaneous: number,
  ): Promise<Run | null>;
  /** Newest first (`queuedAt` desc). */
  listByWorkspace(workspaceId: string, filter: RunListFilter): Promise<Run[]>;
};
