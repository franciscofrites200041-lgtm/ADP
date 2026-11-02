import { createMiddleware } from "hono/factory";

import { errorResponse } from "./http-errors.ts";

/** The slice of Better Auth the middleware needs; tests pass a fake. */
export type SessionReader = {
  api: {
    getSession(context: { headers: Headers }): Promise<{
      user: { id: string };
      session: { activeOrganizationId?: string | null | undefined };
    } | null>;
  };
};

export type WorkspaceEnv = {
  Variables: { userId: string; workspaceId: string };
};

/**
 * Resolves the caller from the session cookie. `workspaceId` comes ONLY from
 * the session, never from the body, the URL or the query (S4).
 */
export function requireWorkspace(auth: SessionReader) {
  return createMiddleware<WorkspaceEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return errorResponse(c, "unauthorized");
    c.set("userId", session.user.id);
    c.set("workspaceId", workspaceId);
    await next();
  });
}
