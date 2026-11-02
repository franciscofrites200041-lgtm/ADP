import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  requireWorkspace,
  type SessionReader,
  type WorkspaceEnv,
} from "./workspace.ts";

type FakeSession = Awaited<ReturnType<SessionReader["api"]["getSession"]>>;

function setup(session: FakeSession) {
  const seen: Headers[] = [];
  const auth: SessionReader = {
    api: {
      getSession: async ({ headers }) => {
        seen.push(headers);
        return session;
      },
    },
  };
  const app = new Hono<WorkspaceEnv>();
  app.all("/api/things", requireWorkspace(auth), (c) =>
    c.json({ userId: c.get("userId"), workspaceId: c.get("workspaceId") }),
  );
  return { app, seen };
}

const signedIn = {
  user: { id: "user-a" },
  session: { activeOrganizationId: "workspace-a" },
};

describe("requireWorkspace", () => {
  it("takes user and workspace from the session", async () => {
    const { app, seen } = setup(signedIn);

    const res = await app.request("/api/things", {
      headers: { cookie: "session=abc" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-a",
      workspaceId: "workspace-a",
    });
    expect(seen[0]?.get("cookie")).toBe("session=abc");
  });

  it("ignores a workspace id in the query, headers or body", async () => {
    const { app } = setup(signedIn);

    const res = await app.request(
      "/api/things?workspaceId=workspace-b&activeOrganizationId=workspace-b",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": "workspace-b",
        },
        body: JSON.stringify({ workspaceId: "workspace-b" }),
      },
    );

    expect(await res.json()).toEqual({
      userId: "user-a",
      workspaceId: "workspace-a",
    });
  });

  it.each([
    ["no session", null],
    [
      "a session without an active workspace",
      { user: { id: "user-a" }, session: { activeOrganizationId: null } },
    ],
  ])("answers 401 unauthorized with %s", async (_label, session) => {
    const { app } = setup(session);

    const res = await app.request("/api/things");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });
});
