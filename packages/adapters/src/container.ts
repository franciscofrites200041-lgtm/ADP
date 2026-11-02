import postgres from "postgres";
import { z } from "zod";

import { type Keyring, keyringFromEnv } from "./envelope.ts";
import { assertNoProviderKeys } from "./provider-env.ts";
import { createWorkspaceKeyVault } from "./workspace-key-vault.ts";

/** Configuration every process that builds the container must provide. */
export const containerEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MW_MASTER_KEY: z.string().min(1),
  MW_MASTER_KEY_VERSION: z.string().min(1),
  MW_MASTER_KEY_PREVIOUS: z.string().optional(),
});

export type ContainerEnv = z.infer<typeof containerEnvSchema>;

export type Container = {
  readonly env: ContainerEnv;
  readonly keyring: Keyring;
  readonly sql: postgres.Sql;
  readonly workspaceKeys: ReturnType<typeof createWorkspaceKeyVault>;
  /** Ends the database pool. Safe to call more than once. */
  readonly close: () => Promise<void>;
};

/** Names the invalid fields only: values may carry credentials. */
export class ContainerConfigError extends Error {
  readonly code = "INVALID_CONFIG";
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid configuration: ${fields.join(", ")}`);
    this.name = "ContainerConfigError";
    this.fields = fields;
  }
}

/**
 * The single composition root (D3, §5). The order is part of the contract:
 * 1. refuse provider credential variables (S3), before reading anything else;
 * 2. validate the configuration with Zod;
 * 3. build the keyring from the master key;
 * 4. only then open the database.
 * The API and worker entrypoints are the only callers (§5 names them
 * `main.ts`; today they are `apps/api/src/index.ts` and `apps/worker/src/index.ts`).
 */
export async function createContainer(
  env: NodeJS.ProcessEnv,
): Promise<Container> {
  assertNoProviderKeys(env);
  const parsed = containerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => String(issue.path[0]));
    throw new ContainerConfigError([...new Set(fields)]);
  }
  const keyring = keyringFromEnv(parsed.data);
  // postgres.js connects lazily, on the first query.
  const sql = postgres(parsed.data.DATABASE_URL);
  let closing: Promise<void> | undefined;
  const container = {
    workspaceKeys: createWorkspaceKeyVault(sql, keyring),
    close: () => {
      closing ??= sql.end();
      return closing;
    },
  };
  // Non-enumerable, so JSON.stringify, spread and console.log never expose the
  // master key or the database password (S2). The cast is safe: all three
  // properties are defined here with exactly the declared types.
  return Object.defineProperties(container, {
    env: { value: parsed.data },
    keyring: { value: keyring },
    sql: { value: sql },
  }) as Container;
}
