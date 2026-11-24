import type { RunEvent } from "@middleware/contracts";

/** What the bus delivers: the store sequence number plus the event itself. */
export type LiveRunEvent = {
  readonly seq: number;
  readonly event: RunEvent;
};

export type LiveEventListener = (message: LiveRunEvent) => void;

/**
 * The in-memory half of the event dual-write (S4): it feeds the request that
 * started the run, in this process only. A reconnecting client never uses
 * the bus; it reads the `RunEventStore` instead (S6), so the bus may drop
 * everything on shutdown and needs no persistence at all.
 */
export type LiveEventBus = {
  /** No-op when nobody is listening; a silent stream is not an error. */
  publish(runId: string, message: LiveRunEvent): void;
  /** Returns an unsubscribe that also drops the per-run listener set. */
  subscribe(runId: string, listener: LiveEventListener): () => void;
};
