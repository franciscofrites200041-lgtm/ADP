import { pathToFileURL } from "node:url";

import { createDbClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seed } from "./seed.js";

/**
 * Thin CLI over the db runtime. The database URL is an explicit positional
 * argument, never read from the environment.
 */
export async function main(argv: string[]): Promise<number> {
  const [command, databaseUrl] = argv;

  if (!command || !databaseUrl) {
    console.error("usage: db <migrate|seed> <DATABASE_URL>");
    return 1;
  }

  try {
    if (command === "migrate") {
      await runMigrations(databaseUrl);
      return 0;
    }

    if (command === "seed") {
      const client = createDbClient(databaseUrl);
      try {
        await seed(client);
      } finally {
        await client.$client.end();
      }
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.error(`unknown command: ${command}`);
  return 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
