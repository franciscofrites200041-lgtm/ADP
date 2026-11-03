import { randomBytes, randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import {
  createAuditLogRepo,
  createContainer,
  createCredentialRepo,
  createCredentialSecretVault,
  createHttpCredentialProbe,
  createInMemoryModelCache,
  createPiModelGateway,
  createSystemClock,
  createUuidV7IdGen,
} from "@middleware/adapters";
import {
  type CredentialProbe,
  createCredentialService,
  createModelService,
  type IdGen,
} from "@middleware/core";
import { createDbClient, runMigrations } from "@middleware/db";
import type { Logger } from "pino";
import { z } from "zod";

import { createApp } from "../app.ts";
import { type Auth, createAuth } from "../auth.ts";
import { createLogger } from "../logger.ts";

class UnsafeTestDatabaseError extends Error {
  readonly code = "UNSAFE_TEST_DATABASE";
}

class TestSessionError extends Error {
  readonly code = "TEST_SESSION_FAILED";
}

/**
 * Opt-in: `DATABASE_URL_TEST`, and only the disposable database. Validated at
 * the boundary like every other environment input (Zod), so a missing or unsafe
 * value is one decision in one place.
 */
const testDatabaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ }).refine(
  (value) => {
    const parsed = new URL(value);
    const isLoopback = parsed.hostname === "127.0.0.1";
    return isLoopback && parsed.pathname === "/middleware_test";
  },
  { message: "Refusing to run against a non-disposable database" },
);

export function testDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL_TEST;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = testDatabaseUrlSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UnsafeTestDatabaseError(
      "Refusing to run against a non-disposable database",
    );
  }
  return parsed.data;
}

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
  });
  const models = createModelService({
    credentialRepo: createCredentialRepo(db),
    secretVault: createCredentialSecretVault(
      container.sql,
      container.workspaceKeys,
    ),
    // pi-ai answers from its catalog without network access.
    modelGateway: createPiModelGateway(),
    modelCache: createInMemoryModelCache(),
    clock: createSystemClock(),
  });
  const app = createApp({
    ready: async () => true,
    auth,
    credentials,
    models,
    allowedOrigins: [TEST_ORIGIN],
    logger,
  });
  const close = async () => {
    await db.$client.end();
    await container.close();
  };
  return { app, auth, sql: container.sql, close };
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
) {
  const {
    app,
    auth,
    sql,
    close: end,
  } = await composeApp(url, logger, idGen, credentialProbe);
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
    // No foreign keys point at the workspace from these three tables.
    for (const id of workspaceIds) {
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

  return { app, sql, signUp, close };
}
