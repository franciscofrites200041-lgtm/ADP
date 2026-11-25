import type { RunStatus } from "@middleware/contracts";

/**
 * How a run was started. Mirrors the `run_trigger` enum in the database:
 * `packages/core` cannot import `@middleware/db`, so the union is repeated
 * here on purpose and the adapter rejects unknown values at the boundary.
 */
export type RunTrigger = "chat" | "api" | "schedule" | "manual" | "delegation";

/** One execution of an agent version, from input to final response (§5). */
export type Run = {
  id: string;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  conversationId: string | null;
  status: RunStatus;
  input: string;
  output: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Model turns already persisted; the executor resumes from here (S5). */
  turnsCompleted: number;
  /**
   * Opaque executor state for the last completed turn; only the executor
   * reads or writes it, so it stays `unknown` here.
   */
  checkpoint: unknown;
  /** Liveness lease of the process running the run; `null` when not leased. */
  leaseUntil: Date | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

/**
 * What `RunRepo.insert` needs: a root run, born `queued`. The group and
 * delegation fields (WP-55) are not part of the chat MVP.
 */
export type RunDraft = {
  id: string;
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  conversationId: string | null;
  trigger: RunTrigger;
  input: string;
};

/** Per-turn progress the executor persists at each checkpoint (S5). */
export type RunProgress = {
  checkpoint: unknown;
  turnsCompleted: number;
};

/** Terminal outcome of a run; `finish` stamps `finishedAt` itself (S7). */
export type RunOutcome =
  | { readonly status: "succeeded"; readonly output: string }
  | {
      readonly status: "failed";
      readonly errorCode: string;
      readonly errorMessage: string;
    }
  | { readonly status: "cancelled"; readonly output: string | null };

export type RunListFilter = {
  status?: RunStatus;
  /**
   * Narrows the page to one agent. It is part of the query, not a read-side
   * slice: filtering after the `limit` cut would hide older matching runs
   * behind a full page of other agents' rows.
   */
  agentId?: string;
  /** Newest first; `limit` caps the page size. */
  limit?: number;
};
