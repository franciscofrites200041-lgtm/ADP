import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";

/**
 * The API requires a verified email before it hands out a session
 * (`requireEmailVerification`). A browser test cannot click a link that only
 * exists in the dev SMTP sink, so the fixture creates the user through the API
 * and marks the email verified in the database, exactly as the link would.
 *
 * Needs the API reachable at `API_INTERNAL_URL` and a disposable PostgreSQL in
 * `DATABASE_URL_TEST`; the spec skips itself when the database is missing.
 */
export type SessionFixture = {
  email: string;
  password: string;
  cookie: { name: string; value: string };
  workspaceId: string;
  dispose: () => Promise<void>;
};

const httpUrl = z.url({ protocol: /^https?$/ });

const environmentSchema = z.object({
  E2E_WEB_ORIGIN: httpUrl.default("http://localhost:3000"),
  API_INTERNAL_URL: httpUrl.default("http://localhost:3001"),
  // A postgres URL, not http: each border gets the shape it really has.
  DATABASE_URL_TEST: z.url({ protocol: /^postgres(ql)?$/ }),
});

/** Better Auth's own answer; we only need to know it is what we expect. */
const signedUpSchema = z.object({
  user: z.object({ id: z.string().min(1), email: z.string().min(1) }),
});

const disposableDatabase = (url: string) => {
  const { hostname, pathname } = new URL(url);
  return hostname === "127.0.0.1" && pathname === "/middleware_test";
};

const postJson = async (
  url: string,
  origin: string,
  body: unknown,
): Promise<{ response: Response; json: unknown }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
  return { response, json: await response.json().catch(() => null) };
};

/** Creates a signed-in user with a verified email and returns its cookie. */
export async function createSession(): Promise<SessionFixture> {
  const { E2E_WEB_ORIGIN, API_INTERNAL_URL, DATABASE_URL_TEST } =
    environmentSchema.parse(process.env);
  if (!disposableDatabase(DATABASE_URL_TEST)) {
    throw new Error("Refusing to run against a non-disposable database");
  }

  const email = `e2e-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const auth = (path: string) => `${API_INTERNAL_URL}/api/auth/${path}`;

  const signUp = await postJson(auth("sign-up/email"), E2E_WEB_ORIGIN, {
    email,
    password,
    name: "E2E",
  });
  if (!signUp.response.ok) {
    throw new Error(`sign-up failed: ${signUp.response.status}`);
  }
  signedUpSchema.parse(signUp.json);

  const sql = postgres(DATABASE_URL_TEST, { max: 1 });
  try {
    await sql`update "user" set email_verified = true where email = ${email}`;
    const [row] = await sql<{ organization_id: string }[]>`
      select m.organization_id from member m
      join "user" u on u.id = m.user_id
      where u.email = ${email}`;
    if (!row) throw new Error("the new user has no workspace");

    const signIn = await postJson(auth("sign-in/email"), E2E_WEB_ORIGIN, {
      email,
      password,
    });
    if (!signIn.response.ok) {
      throw new Error(`sign-in failed: ${signIn.response.status}`);
    }
    const raw = signIn.response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0] ?? "")
      .find((cookie) => cookie.includes("session_token"));
    const [name, ...value] = raw?.split("=") ?? [];
    if (!name || value.length === 0) {
      throw new Error("no session cookie in the sign-in response");
    }

    const workspaceId = row.organization_id;
    return {
      email,
      password,
      cookie: { name, value: value.join("=") },
      workspaceId,
      dispose: async () => {
        // The setup client is already closed here: clean up on a fresh one.
        const cleanup = postgres(DATABASE_URL_TEST, { max: 1 });
        try {
          await cleanup`delete from provider_credential where workspace_id = ${workspaceId}`;
          await cleanup`delete from audit_log where workspace_id = ${workspaceId}`;
          await cleanup`delete from workspace_key where workspace_id = ${workspaceId}`;
          await cleanup`delete from organization where id = ${workspaceId}`;
          await cleanup`delete from "user" where email = ${email}`;
          await cleanup`delete from verification where identifier = ${email}`;
        } finally {
          await cleanup.end();
        }
      },
    };
  } finally {
    await sql.end();
  }
}
