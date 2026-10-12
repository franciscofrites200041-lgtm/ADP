import type { DbClient } from "./client.js";

/**
 * A single idempotent seed write. Re-running a step must never duplicate
 * rows (e.g. `insert ... onConflictDoNothing`); the registry guarantees the
 * full seed is safe to run more than once.
 */
export interface SeedStep {
  readonly name: string;
  run(db: DbClient): Promise<void>;
}

/**
 * Ordered registry of idempotent seed steps.
 *
 * Intentionally empty: the six concrete agent templates are WP-21 scope and
 * will be registered here once their data exists. Until then, seeding is an
 * explicit, idempotent no-op that touches no tables.
 */
export const seedSteps: readonly SeedStep[] = [];

/**
 * Runs every registered seed step once, in order, against the given client.
 * Safe to call repeatedly: steps are idempotent by contract and the current
 * registry is empty.
 */
export async function seed(
  db: DbClient,
  steps: readonly SeedStep[] = seedSteps,
): Promise<void> {
  for (const step of steps) {
    await step.run(db);
  }
}
