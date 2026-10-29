import type postgres from "postgres";
import { z } from "zod";

import type { Keyring } from "./envelope.ts";
import type { createWorkspaceKeyVault } from "./workspace-key-vault.ts";

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

/** Removed by the implementation PR; exists so the contract tests fail red. */
export class ContainerNotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";

  constructor() {
    super("createContainer is a contract stub");
    this.name = "ContainerNotImplementedError";
  }
}

/**
 * The single composition root (D3, §5). The order is part of the contract:
 * 1. refuse provider credential variables (S3), before reading anything else;
 * 2. validate the configuration with Zod;
 * 3. build the keyring from the master key;
 * 4. only then open the database.
 * `apps/api/src/main.ts` and `apps/worker/src/main.ts` are the only callers.
 */
export async function createContainer(
  _env: NodeJS.ProcessEnv,
): Promise<Container> {
  throw new ContainerNotImplementedError();
}
