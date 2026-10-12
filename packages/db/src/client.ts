import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

/**
 * Creates a typed Drizzle client backed by postgres.js.
 *
 * The database URL is an explicit parameter: library code never reads
 * `DATABASE_URL` (or any other secret) from the environment. Callers (API,
 * CLI, jobs) own how the URL is obtained and pass it in per execution.
 */
export function createDbClient(databaseUrl: string) {
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}

/** The typed client returned by {@link createDbClient}. */
export type DbClient = ReturnType<typeof createDbClient>;
