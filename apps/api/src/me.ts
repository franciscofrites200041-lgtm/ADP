import { Hono } from "hono";

import type { Auth } from "./auth.ts";

/**
 * `GET /api/me`: the signed-in user and their active workspace. The workspace
 * id is read from the session only; no request data influences it (S4).
 */
export function meRoutes(auth: Auth): Hono {
  const app = new Hono();

  app.get("/api/me", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) {
      return c.json(
        { error: { code: "UNAUTHENTICATED", message: "No iniciaste sesión." } },
        401,
      );
    }
    const { id, name, email } = session.user;
    return c.json({
      user: { id, name, email },
      workspace: { id: workspaceId },
    });
  });

  return app;
}
