import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup() {
  const table = (): Record<string, unknown>[] => [];
  const db = {
    user: table(),
    session: table(),
    account: table(),
    verification: table(),
    organization: table(),
    member: table(),
    invitation: table(),
  };
  const auth = createAuth({
    database: memoryAdapter(db),
    secret: "s".repeat(32),
    baseURL: "http://localhost:3001",
    mailer: { send: async () => {} },
  });
  const app = createApp({ ready: async () => true, auth });
  return { app, db };
}

async function signUp(app: ReturnType<typeof setup>["app"], email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3001",
    },
    body: JSON.stringify({ email, password: "correct-horse-1", name: "Ana" }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { res, cookie };
}

async function me(
  app: ReturnType<typeof setup>["app"],
  cookie: string,
  path = "/api/me",
) {
  return app.request(path, { headers: { cookie } });
}

describe("auth", () => {
  it("S1: sign-up creates a UUID user plus an owner workspace", async () => {
    const { app, db } = setup();
    const { res } = await signUp(app, "ana@example.com");

    expect(res.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.user[0]?.id).toMatch(UUID_V7);
    expect(db.organization).toHaveLength(1);
    expect(db.organization[0]?.id).toMatch(UUID_V7);
    expect(db.member[0]).toMatchObject({
      userId: db.user[0]?.id,
      organizationId: db.organization[0]?.id,
      role: "owner",
    });
  });

  it("S1: rejects creating a second workspace through the organization API", async () => {
    const { app } = setup();
    const { cookie } = await signUp(app, "ana@example.com");

    const res = await app.request("/api/auth/organization/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost:3001",
      },
      body: JSON.stringify({
        name: "Second workspace",
        slug: "second-workspace",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("S2: /api/me returns the user and session workspace", async () => {
    const { app, db } = setup();
    const { cookie } = await signUp(app, "ana@example.com");

    const res = await me(app, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: db.user[0]?.id, name: "Ana", email: "ana@example.com" },
      workspace: { id: db.organization[0]?.id },
    });
  });

  it("S2: /api/me is 401 without a session", async () => {
    const { app } = setup();
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("S2: sign-in works through the mounted /api/auth/* handler", async () => {
    const { app } = setup();
    await signUp(app, "ana@example.com");
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3001",
      },
      body: JSON.stringify({
        email: "ana@example.com",
        password: "correct-horse-1",
      }),
    });
    expect(res.status).toBe(200);
    const { cookie } = {
      cookie: res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
    expect((await me(app, cookie)).status).toBe(200);
  });

  it("S3: workspaceId in query, header or body never overrides the session", async () => {
    const { app, db } = setup();
    const a = await signUp(app, "a@example.com");
    await signUp(app, "b@example.com");
    const workspaceB = db.organization[1]?.id as string;

    const res = await app.request(`/api/me?workspaceId=${workspaceB}`, {
      method: "GET",
      headers: { cookie: a.cookie, "x-workspace-id": workspaceB },
    });
    expect(await res.json()).toMatchObject({
      workspace: { id: db.organization[0]?.id },
    });
  });

  it("keeps readiness behavior and omits auth routes when no auth is injected", async () => {
    const app = createApp({ ready: async () => true });
    expect((await app.request("/readyz")).status).toBe(200);
    expect((await app.request("/api/me")).status).toBe(404);
  });
});
