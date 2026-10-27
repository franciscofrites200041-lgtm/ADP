import { Hono } from "hono";

import type { Auth } from "./auth.ts";
import { meRoutes } from "./me.ts";

/** Injected asynchronous PostgreSQL readiness check. */
export type ReadinessChecker = () => Promise<boolean>;

export interface CreateAppOptions {
  ready: ReadinessChecker;
  /** Better Auth instance; when absent, auth routes are not mounted. */
  auth?: Auth;
}

/**
 * Builds the Hono app with an injected readiness check so tests (and future
 * callers) control PostgreSQL reachability instead of the app reaching out
 * itself. `/readyz` reports ready only when the checker resolves `true`.
 */
export function createApp({ ready, auth }: CreateAppOptions): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/readyz", async (c) => {
    try {
      if (await ready()) {
        return c.text("ok");
      }
    } catch {
      // A rejected check means "not ready" (e.g. the database is unreachable).
    }
    return c.text("not ready", 503);
  });

  if (auth) {
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
    app.route("/", meRoutes(auth));
  }

  return app;
}
