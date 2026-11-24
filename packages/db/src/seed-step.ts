import type { DbClient } from "./client.ts";

/**
 * A single idempotent seed write. Re-running a step must never duplicate
 * rows (e.g. `insert ... onConflictDoNothing`); the registry guarantees the
 * full seed is safe to run more than once.
 *
 * Lives in its own module because steps implement it while the registry
 * consumes it: keeping it in `seed.ts` made every step import the file that
 * imports every step, a real import cycle.
 */
export interface SeedStep {
  readonly name: string;
  run(db: DbClient): Promise<void>;
}
