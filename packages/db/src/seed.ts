import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { DbClient } from "./client.ts";
import * as schema from "./schema/index.ts";
import { seedAgentTemplates } from "./seed-agent-templates.ts";
import type { SeedStep } from "./seed-step.ts";

// Re-exported so existing consumers keep importing the type from here.
export type { SeedStep };

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
