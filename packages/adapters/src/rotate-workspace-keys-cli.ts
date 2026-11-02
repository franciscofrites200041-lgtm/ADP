import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { z } from "zod";

import { CryptoError, keyringFromEnv } from "./envelope.ts";
import {
  rotateWorkspaceKeys,
  type WorkspaceKeyStore,
} from "./rotate-workspace-keys.ts";
import { createPostgresWorkspaceKeyStore } from "./rotate-workspace-keys-db.ts";

const HELP = `Re-wrap every workspace DEK under the current KEK (S4, WP-06).

Usage: node src/rotate-workspace-keys-cli.ts

No arguments: secrets travel only through the environment.
  DATABASE_URL             Postgres to rotate (read/write on workspace_key).
  MW_MASTER_KEY            New KEK, 32 bytes in base64.
  MW_MASTER_KEY_VERSION    Label of the new KEK (e.g. v2).
  MW_MASTER_KEY_PREVIOUS   Old KEKs as version:base64, comma-separated.

Prints {"scanned","rotated","skipped"}. Safe to re-run. Aborts if any row
changes while rotating. Keep the old KEKs while encrypted backups exist.
See docs/runbooks/rotar-clave-maestra.md.
`;

const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

export class RotationConfigError extends Error {
  readonly code = "INVALID_DATABASE_URL";

  constructor() {
    // The value is never echoed: it may carry credentials.
    super("DATABASE_URL is missing or malformed");
    this.name = "RotationConfigError";
  }
}

type Io = { out: (s: string) => void; err: (s: string) => void };
type OpenStore = (
  url: string,
) => Promise<{ store: WorkspaceKeyStore; close: () => Promise<void> }>;

const openPostgres: OpenStore = async (url) => {
  const sql = postgres(url, { max: 1 });
  return {
    store: createPostgresWorkspaceKeyStore(sql),
    close: () => sql.end(),
  };
};

/** Returns the process exit code. Output never includes keys or the URL. */
export async function runRotateCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Io,
  openStore: OpenStore = openPostgres,
): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    io.out(HELP);
    return 0;
  }
  if (argv.length > 0) {
    io.err("Unexpected arguments. Run with --help.\n");
    return 2;
  }
  try {
    const ring = keyringFromEnv(env);
    const url = databaseUrlSchema.safeParse(env.DATABASE_URL);
    if (!url.success) throw new RotationConfigError();
    const { store, close } = await openStore(url.data);
    try {
      const result = await rotateWorkspaceKeys({
        ring,
        store,
        rotatedAt: new Date(),
      });
      io.out(`${JSON.stringify(result)}\n`);
      return 0;
    } finally {
      await close();
    }
  } catch (error) {
    // Only the typed code is printed: driver and crypto messages may carry context.
    const code =
      error instanceof CryptoError || error instanceof RotationConfigError
        ? error.code
        : "ROTATION_FAILED";
    io.err(`Rotation failed (${code}).\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runRotateCli(process.argv.slice(2), process.env, {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
