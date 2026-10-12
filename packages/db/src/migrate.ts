import { fileURLToPath } from "node:url";

import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";

import { createDbClient } from "./client.js";

/** Generated migration artifacts (`out` in drizzle.config.ts). */
const defaultMigrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

/**
 * Applies pending Drizzle migrations from the generated `drizzle` folder.
 *
 * The database URL is an explicit boundary argument; it is never read from
 * the environment. A dedicated client is opened for the migration run and
 * closed afterwards.
 */
export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  const client = createDbClient(databaseUrl);
  try {
    await drizzleMigrate(client, { migrationsFolder });
  } finally {
    await client.$client.end();
  }
}
