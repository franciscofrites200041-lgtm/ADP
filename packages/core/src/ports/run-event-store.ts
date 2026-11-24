import type { RunEvent } from "@middleware/contracts";

/** One persisted run event with its per-run, gap-free sequence number (S4). */
export type StoredRunEvent = {
  readonly seq: number;
  readonly event: RunEvent;
  readonly createdAt: Date;
};

/**
 * The durable half of the event dual-write (S4): what a reconnecting client
 * reads when the process that started the run is gone (S6). Every method
 * scopes by `workspaceId` first (S4).
 */
export type RunEventStore = {
  /**
   * Persists a batch under consecutive `seq` numbers, atomically: two
   * concurrent appends for the same run never produce a gap, a duplicate or
   * a unique-violation leak; the caller gets the stored rows back.
   */
  append(
    workspaceId: string,
    runId: string,
    events: readonly RunEvent[],
  ): Promise<StoredRunEvent[]>;
  /** Events strictly after `afterSeq`, ordered by `seq` ascending. */
  listAfter(
    workspaceId: string,
    runId: string,
    afterSeq: number,
    limit?: number,
  ): Promise<StoredRunEvent[]>;
};
