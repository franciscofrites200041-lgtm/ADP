import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { serve } from "@hono/node-server";
import {
  createAgentRepo,
  createAuditLogRepo,
  createContainer,
  createCredentialRepo,
  createCredentialSecretVault,
  createInMemoryModelCache,
  createPiModelGateway,
  createSystemClock,
  createUuidV7IdGen,
} from "@middleware/adapters";
import {
  createAgentService,
  createCredentialService,
  createModelService,
  createRunService,
} from "@middleware/core";
import { createDbClient, ping } from "@middleware/db";

import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { readEnv } from "./env.ts";
import { createLogger } from "./logger.ts";
import { createSmtpMailer } from "./mailer.ts";
import { registerShutdown } from "./shutdown.ts";

const port = 3001;

// First: refuses provider keys and invalid configuration before anything starts (S3).
const container = await createContainer(process.env);
const {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  SMTP_URL,
  MAIL_FROM,
  MW_SHUTDOWN_GRACE_SECONDS,
} = readEnv(process.env);
// Better Auth keeps its own Drizzle client until WP-03 moves it into the container.
const dbClient = createDbClient(container.env.DATABASE_URL);
// The adapter reads the schema from the client (`db._.fullSchema`).
const auth = createAuth({
  database: drizzleAdapter(dbClient, { provider: "pg" }),
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  mailer: createSmtpMailer(SMTP_URL, MAIL_FROM),
});
const credentials = createCredentialService({
  credentialRepo: createCredentialRepo(dbClient),
  // Built in the container over the guard and the pinned-address client, so a
  // stored base URL can never leave through an unprotected fetch (S5).
  credentialProbe: container.credentialProbe,
  secretVault: createCredentialSecretVault(
    container.sql,
    container.workspaceKeys,
  ),
  auditLog: createAuditLogRepo(dbClient),
  clock: createSystemClock(),
  idGen: createUuidV7IdGen(),
  // Compatible base URLs are approved before anything is stored (S5).
  urlGuard: container.urlGuard,
});
const models = createModelService({
  credentialRepo: createCredentialRepo(dbClient),
  secretVault: createCredentialSecretVault(
    container.sql,
    container.workspaceKeys,
  ),
  // Compatible base URLs go through the SSRF guard and the pinned-address
  // client (S5); every other provider keeps its catalog path.
  modelGateway: createPiModelGateway({
    urlGuard: container.urlGuard,
    safeFetch: container.safeFetch,
  }),
  modelCache: createInMemoryModelCache(),
  clock: createSystemClock(),
});
const agents = createAgentService({
  agentRepo: createAgentRepo(dbClient),
  credentialRepo: createCredentialRepo(dbClient),
  auditLog: createAuditLogRepo(dbClient),
  clock: createSystemClock(),
  idGen: createUuidV7IdGen(),
});
// The chat engine (T1–T5): the run repos, the event store and the bus come
// from the container, over the same pool the container closes on shutdown.
const idGen = createUuidV7IdGen();
const runs = createRunService({
  agentRepo: createAgentRepo(dbClient),
  credentialRepo: createCredentialRepo(dbClient),
  conversationRepo: container.conversationRepo,
  messageRepo: container.messageRepo,
  runRepo: container.runRepo,
  runEventStore: container.runEventStore,
  liveEventBus: container.liveEventBus,
  backgroundTasks: container.backgroundTasks,
  agentRuntime: container.agentRuntime,
  secretVault: createCredentialSecretVault(
    container.sql,
    container.workspaceKeys,
  ),
  usageRepo: container.usageRepo,
  clock: createSystemClock(),
  idGen,
});
const logger = createLogger();
const app = createApp({
  ready: () => ping(dbClient),
  auth,
  credentials,
  models,
  agents,
  runs: {
    service: runs,
    runRepo: container.runRepo,
    eventStore: container.runEventStore,
    liveBus: container.liveEventBus,
  },
  conversations: {
    conversations: container.conversationRepo,
    messages: container.messageRepo,
    idGen,
  },
  allowedOrigins: [BETTER_AUTH_URL],
  logger,
});

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info(`[api] listening on port ${port}`);
});

registerShutdown({
  server,
  close: async () => {
    // Runs outlive their requests (S2): let them settle before the pools
    // close. A run still going after the grace is abandoned, like the
    // server itself.
    await container.backgroundTasks.drain(MW_SHUTDOWN_GRACE_SECONDS * 1000);
    await container.close();
    await dbClient.$client.end();
  },
  logger,
  graceMs: MW_SHUTDOWN_GRACE_SECONDS * 1000,
  exit: (code) => process.exit(code),
});
