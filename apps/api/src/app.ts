import type { CredentialService } from "@middleware/core";
import { Hono } from "hono";
import type { Logger } from "pino";

import type { Auth } from "./auth.ts";
import { credentialRoutes } from "./credentials-routes.ts";
import { createErrorHandler } from "./http-errors.ts";
import { createLogger } from "./logger.ts";
import { meRoutes } from "./me.ts";

/** Injected asynchronous PostgreSQL readiness check. */
export type ReadinessChecker = () => Promise<boolean>;

export interface CreateAppOptions {
  ready: ReadinessChecker;
  /** Better Auth instance; when absent, auth routes are not mounted. */
  auth?: Auth;
  /** Credential use cases; mounted only together with `auth`. */
  credentials?: CredentialService;
  /** Origins allowed to write; defaults to none, which rejects every write. */
  allowedOrigins?: readonly string[];
  logger?: Logger;
}

/**
 * Builds the Hono app with an injected readiness check so tests (and future
 * callers) control PostgreSQL reachability instead of the app reaching out
 * itself. `/readyz` reports ready only when the checker resolves `true`.
 */
export function createApp({
  ready,
  auth,
  credentials,
  allowedOrigins = [],
  logger = createLogger(),
}: CreateAppOptions): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(logger));

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
    if (credentials) {
      app.route("/", credentialRoutes(auth, credentials, allowedOrigins));
    }
  }

  return app;
}
