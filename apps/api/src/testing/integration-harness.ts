import { randomBytes, randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
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
  // The disposable-database guard is shared, not copied (ADR-0006): every
  // Postgres-backed suite resolves its URL through the same function.
  testDatabaseUrl,
} from "@middleware/adapters";
import {
  type AgentRuntime,
  type CredentialProbe,
  createAgentService,
  createCredentialService,
  createModelService,
  createRunService,
  type IdGen,
} from "@middleware/core";
import { createDbClient, runMigrations } from "@middleware/db";
import type { Logger } from "pino";

import { createApp } from "../app.ts";
import { type Auth, createAuth } from "../auth.ts";
import { createLogger } from "../logger.ts";

class TestSessionError extends Error {
  readonly code = "TEST_SESSION_FAILED";
}

// Re-exported so every suite of this app keeps importing it from one place;
// the skip-or-fail-loudly rule lives in the shared guard, not here.
export { testDatabaseUrl };

/** The web origin the harness impersonates; requests must send it (S10). */
export const TEST_ORIGIN = "http://localhost:3001";

export type TestSession = {
  cookie: string;
  userId: string;
  workspaceId: string;
};

/** The real app over the disposable database, composed like `index.ts`. */
async function composeApp(
  url: string,
  logger: Logger,
  idGen: IdGen,
  credentialProbe: CredentialProbe = {
    // Deterministic and offline: a test that cares about the outcome injects
    // its own probe, and no suite ever reaches a real provider (§14).
    async probe() {
      return { status: "invalid", code: "provider_error" };
    },
  },
  agentRuntime?: AgentRuntime,
) {
  await runMigrations(url);
  const container = await createContainer({
    DATABASE_URL: url,
    MW_MASTER_KEY: randomBytes(32).toString("base64"),
    MW_MASTER_KEY_VERSION: "test-v1",
  });
  const db = createDbClient(url);
  const auth = createAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: "s".repeat(32),
    baseURL: TEST_ORIGIN,
    mailer: { send: async () => {} },
  });
  const credentials = createCredentialService({
    credentialRepo: createCredentialRepo(db),
    // Real probe by default; a test that needs a deterministic answer injects
    // its own through the same seam the container uses.
    credentialProbe,
    secretVault: createCredentialSecretVault(
      container.sql,
      container.workspaceKeys,
    ),
    auditLog: createAuditLogRepo(db),
    clock: createSystemClock(),
    idGen,
    // The container's guard approves base URLs before storage, exactly like
    // production (S5).
    urlGuard: container.urlGuard,
  });
  const models = createModelService({
    credentialRepo: createCredentialRepo(db),
    secretVault: createCredentialSecretVault(
      container.sql,
      container.workspaceKeys,
    ),
    // pi-ai answers from its catalog without network access; compatible base
    // URLs go through the container's single SSRF guard and pinned client,
    // exactly as production (S5).
    modelGateway: createPiModelGateway({
      urlGuard: container.urlGuard,
      safeFetch: container.safeFetch,
    }),
    modelCache: createInMemoryModelCache(),
    clock: createSystemClock(),
  });
  const agents = createAgentService({
    agentRepo: createAgentRepo(db),
    credentialRepo: createCredentialRepo(db),
    auditLog: createAuditLogRepo(db),
    clock: createSystemClock(),
    idGen,
  });
  // The chat engine (T1–T5) composed like `index.ts`: real repos over the
  // disposable database, with the runtime injectable so a suite can swap in
  // the faux provider and never reach a real one (§14).
  const runs = createRunService({
    agentRepo: createAgentRepo(db),
    credentialRepo: createCredentialRepo(db),
    conversationRepo: container.conversationRepo,
    messageRepo: container.messageRepo,
    runRepo: container.runRepo,
    runEventStore: container.runEventStore,
    liveEventBus: container.liveEventBus,
    backgroundTasks: container.backgroundTasks,
    agentRuntime: agentRuntime ?? container.agentRuntime,
    secretVault: createCredentialSecretVault(
      container.sql,
      container.workspaceKeys,
    ),
    usageRepo: container.usageRepo,
    clock: createSystemClock(),
    idGen,
  });
  const app = createApp({
    ready: async () => true,
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
    allowedOrigins: [TEST_ORIGIN],
    logger,
  });
  const close = async () => {
    await db.$client.end();
    await container.close();
  };
  return {
    app,
    auth,
    sql: container.sql,
    backgroundTasks: container.backgroundTasks,
    close,
  };
}

/** The postgres.js client composed above, without importing its types. */
type HarnessSql = Awaited<ReturnType<typeof composeApp>>["sql"];

async function signUpAndSignIn(
  auth: Auth,
  sql: HarnessSql,
  email: string,
  name: string,
) {
  const password = `pw-${randomUUID()}`;
  await auth.api.signUpEmail({ body: { email, password, name } });
  // Verification is required (S10); this is what clicking the link does.
  await sql`update "user" set email_verified = true where email = ${email}`;
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  const workspaceId = session?.session.activeOrganizationId;
  if (!session || !workspaceId) throw new TestSessionError("no session");
  return { cookie, userId: session.user.id, workspaceId };
}

/**
 * Real users and workspaces through Better Auth. `close` deletes only the
 * rows of the users and workspaces this harness created.
 */
export async function createIntegrationHarness(
  url: string,
  logger: Logger = createLogger(),
  idGen: IdGen = createUuidV7IdGen(),
  credentialProbe?: CredentialProbe,
  agentRuntime?: AgentRuntime,
) {
  const {
    app,
    auth,
    sql,
    backgroundTasks,
    close: end,
  } = await composeApp(url, logger, idGen, credentialProbe, agentRuntime);
  const emails: string[] = [];
  const workspaceIds: string[] = [];

  async function signUp(name: string): Promise<TestSession> {
    const email = `api-${randomUUID()}@example.com`;
    emails.push(email);
    const session = await signUpAndSignIn(auth, sql, email, name);
    workspaceIds.push(session.workspaceId);
    return session;
  }

  async function close() {
    // Runs outlive their requests: drain them before tearing rows down (S2).
    await backgroundTasks.drain(15_000);
    for (const id of workspaceIds) {
      // Children first: run rows carry FKs to agent, agent_version and the
      // tables below, so the run family goes before the agent family.
      await sql`update schedule set last_run_id = null
        where workspace_id = ${id}`;
      await sql`delete from run_event where workspace_id = ${id}`;
      await sql`delete from approval where workspace_id = ${id}`;
      await sql`delete from tool_call where workspace_id = ${id}`;
      await sql`delete from usage_record where workspace_id = ${id}`;
      await sql`delete from delivery where workspace_id = ${id}`;
      await sql`delete from message where workspace_id = ${id}`;
      await sql`delete from run where workspace_id = ${id}`;
      await sql`delete from conversation where workspace_id = ${id}`;
      // Children first: agent_version points at agent and credential.
      await sql`delete from agent_version where workspace_id = ${id}`;
      await sql`delete from agent where workspace_id = ${id}`;
      await sql`delete from provider_credential where workspace_id = ${id}`;
      await sql`delete from audit_log where workspace_id = ${id}`;
      await sql`delete from workspace_key where workspace_id = ${id}`;
      // Cascades to member and invitation.
      await sql`delete from organization where id = ${id}`;
    }
    for (const email of emails) {
      // Cascades to session, account and member.
      await sql`delete from "user" where email = ${email}`;
      await sql`delete from verification where identifier = ${email}`;
    }
    await end();
  }

  return {
    app,
    sql,
    signUp,
    /** Resolves once every tracked run settled (or the timeout passed). */
    drain: () => backgroundTasks.drain(15_000),
    close,
  };
}
