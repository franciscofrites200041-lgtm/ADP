import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { serve } from "@hono/node-server";
import {
  createAuditLogRepo,
  createContainer,
  createCredentialRepo,
  createCredentialSecretVault,
  createSystemClock,
  createUuidV7IdGen,
} from "@middleware/adapters";
import { createCredentialService } from "@middleware/core";
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
  secretVault: createCredentialSecretVault(
    container.sql,
    container.workspaceKeys,
  ),
  auditLog: createAuditLogRepo(dbClient),
  clock: createSystemClock(),
  idGen: createUuidV7IdGen(),
});
const logger = createLogger();
const app = createApp({
  ready: () => ping(dbClient),
  auth,
  credentials,
  allowedOrigins: [BETTER_AUTH_URL],
  logger,
});

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info(`[api] listening on port ${port}`);
});

registerShutdown({
  server,
  close: async () => {
    await container.close();
    await dbClient.$client.end();
  },
  logger,
  graceMs: MW_SHUTDOWN_GRACE_SECONDS * 1000,
  exit: (code) => process.exit(code),
});
