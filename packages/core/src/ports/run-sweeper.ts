/**
 * One orphaned run: only the identifiers the re-enqueue needs (§5). The sweep
 * deliberately carries no `input`, `output` or error fields: it cannot leak
 * run content a system job never reads.
 */
export type SweptRun = { workspaceId: string; runId: string };

/**
 * The system-level sweep of runs stuck in `running` whose lease expired (§5):
 * the orphans a crashed process left behind, which the tick re-enqueues with
 * `run.resume`.
 *
 * This is the one workspace-less read of the whole system, recorded in
 * ADR-0007: the tick is a sweep over the whole table, not a user request, and
 * no session exists to scope by. It lives in its own port, never inside
 * `RunRepo`, so the exception stays explicit and `RunRepo` remains fully
 * scoped (S4).
 */
export type RunSweeper = {
  /** Runs in `running` whose lease expired, oldest lease first. */
  listExpiredLeases(now: Date): Promise<SweptRun[]>;
};
