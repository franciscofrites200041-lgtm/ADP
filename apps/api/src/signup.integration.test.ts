import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDbClient, runMigrations } from "@middleware/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "./auth.ts";
import type { MailMessage } from "./mailer.ts";

class UnsafeTestDatabaseError extends Error {
  readonly code = "UNSAFE_TEST_DATABASE";
}

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new UnsafeTestDatabaseError(
      "Refusing to run against a non-disposable database",
    );
  }
}

describe.skipIf(!url)("sign-up against postgres", () => {
  const db = createDbClient(url ?? "");
  const sql = db.$client;
  const sent: MailMessage[] = [];
  const auth = createAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: "s".repeat(32),
    baseURL: "http://localhost:3001",
    mailer: {
      send: async (message) => {
        sent.push(message);
      },
    },
  });
  const email = `signup-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;

  beforeAll(async () => {
    await runMigrations(url ?? "");
  });

  afterAll(async () => {
    // Organizations cascade to member/invitation; the user cascades to
    // session/account/member.
    await sql`delete from organization where id in (
      select m.organization_id from member m
      join "user" u on u.id = m.user_id where u.email = ${email})`;
    await sql`delete from "user" where email = ${email}`;
    await sql`delete from verification where identifier = ${email}`;
    await sql.end();
  });

  it("gives a new user exactly one owner workspace, a verification email and a session", async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "Ana" },
    });
    expect(signUp.user.email).toBe(email);

    const memberships = await sql<{ organization_id: string; role: string }[]>`
      select m.organization_id, m.role from member m
      join "user" u on u.id = m.user_id where u.email = ${email}`;
    expect(memberships.map((m) => m.role)).toEqual(["owner"]);
    const organizations = await sql`
      select o.id from organization o
      join member m on m.organization_id = o.id
      join "user" u on u.id = m.user_id where u.email = ${email}`;
    expect(organizations).toHaveLength(1);

    // Only recipient and subject: the body carries a verification token.
    expect(
      sent
        .filter((m) => m.to === email)
        .map((m) => ({ to: m.to, subject: m.subject })),
    ).toEqual([{ to: email, subject: "Confirmá tu email" }]);

    // Unverified sign-in is rejected (S10); clicking the link sets this flag.
    const denied = await auth.api
      .signInEmail({ body: { email, password } })
      .catch((error: unknown) => error);
    expect(denied).toMatchObject({ status: "FORBIDDEN" });
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
    expect(session?.user.email).toBe(email);
    expect(session?.session.activeOrganizationId).toBe(
      memberships[0]?.organization_id,
    );
    // Signing in again reuses the workspace instead of creating another.
    const after = await sql`
      select 1 from member m
      join "user" u on u.id = m.user_id where u.email = ${email}`;
    expect(after).toHaveLength(1);
  });
});
