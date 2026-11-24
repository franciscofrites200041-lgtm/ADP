import type {
  AgentRuntime,
  BackgroundTasks,
  ConversationRepo,
  LiveEventBus,
  MessageRepo,
  RunEventStore,
  RunRepo,
  UrlGuard,
  UsageRepo,
} from "@middleware/core";
import { schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { createPiAgentRuntime } from "./agent-runtime.ts";
import { createBackgroundTasks } from "./background-tasks.ts";
import { createConversationRepo } from "./conversation-repo.ts";
import { createHttpCredentialProbe } from "./credential-probe.ts";
import { type Keyring, keyringFromEnv } from "./envelope.ts";
import { createInMemoryLiveEventBus } from "./live-event-bus.ts";
import { createMessageRepo } from "./message-repo.ts";
import { assertNoProviderKeys } from "./provider-env.ts";
import { createRunEventStore } from "./run-event-store.ts";
import { createRunRepo } from "./run-repo.ts";
import { createSafeFetch } from "./safe-fetch.ts";
import { createUrlGuard } from "./url-guard.ts";
import { createUsageRepo } from "./usage-repo.ts";
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
  /** Approves user-supplied URLs and pins their addresses (S5). */
  readonly urlGuard: UrlGuard;
  /** The protected HTTP client built over `urlGuard`; no secrets inside. */
  readonly safeFetch: typeof fetch;
  /**
   * The credential probe, wired to the guard and the pinned-address client
   * above, so a stored base URL never leaves through a raw fetch (S5).
   */
  readonly credentialProbe: ReturnType<typeof createHttpCredentialProbe>;
  /** Run repos over the same pool as `sql`; one pool, one `close` (§5). */
  readonly runRepo: RunRepo;
  readonly runEventStore: RunEventStore;
  /** Conversation storage of the chat MVP (S7, S11); same pool. */
  readonly conversationRepo: ConversationRepo;
  readonly messageRepo: MessageRepo;
  readonly usageRepo: UsageRepo;
  /** In-process fan-out to the request that started a run (S4). */
  readonly liveEventBus: LiveEventBus;
  /**
   * The agent loop behind its port (S3), wired to the same guard and
   * pinned-address client the gateway uses; one fresh turn per call.
   */
  readonly agentRuntime: AgentRuntime;
  /** Registered promises the process drains on shutdown (S2). */
  readonly backgroundTasks: BackgroundTasks;
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
  // The run plumbing (T3/T5) shares this pool: repos take `sql`, so closing
  // the container ends the connections exactly once.
  const db = drizzle(sql, { schema });
  let closing: Promise<void> | undefined;
  // One guard and one client per process; both hold no secrets, so they can
  // stay enumerable (unlike `env`, `keyring` and `sql` below).
  const urlGuard = createUrlGuard();
  const safeFetch = createSafeFetch({ guard: urlGuard });
  const container = {
    runRepo: createRunRepo(db),
    runEventStore: createRunEventStore(db),
    conversationRepo: createConversationRepo(db),
    messageRepo: createMessageRepo(db),
    usageRepo: createUsageRepo(db),
    liveEventBus: createInMemoryLiveEventBus(),
    agentRuntime: createPiAgentRuntime({ urlGuard, safeFetch }),
    backgroundTasks: createBackgroundTasks(),
    workspaceKeys: createWorkspaceKeyVault(sql, keyring),
    urlGuard,
    safeFetch,
    credentialProbe: createHttpCredentialProbe({ urlGuard, safeFetch }),
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
