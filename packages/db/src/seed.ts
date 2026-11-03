import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DbClient } from "./client.ts";
import * as schema from "./schema/index.ts";
import { seedAgentTemplates } from "./seed-agent-templates.ts";

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
 * The six agent templates of WP-21 are the first entries. Every step must stay
 * idempotent, so running the seed twice is always safe.
 */
export const seedSteps: readonly SeedStep[] = [seedAgentTemplates];

/**
 * Runs every registered seed step once, in order, against the given client.
 * Safe to call repeatedly: every registered step is idempotent by contract.
 */
export async function seed(
  db: DbClient,
  steps: readonly SeedStep[] = seedSteps,
): Promise<void> {
  for (const step of steps) {
    await step.run(db);
  }
}

/**
 * Seeds a database it opens and closes itself, so a caller (the CLI, a test or
 * a deploy step) cannot leak the connection. Safe to run more than once.
 */
export async function seedDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl);
  try {
    await seed(drizzle(sql, { schema }));
  } finally {
    await sql.end();
  }
}
