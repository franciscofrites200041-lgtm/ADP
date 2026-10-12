import { Hono } from "hono";

/** Injected asynchronous PostgreSQL readiness check. */
export type ReadinessChecker = () => Promise<boolean>;

export interface CreateAppOptions {
  ready: ReadinessChecker;
}

/**
 * Builds the Hono app with an injected readiness check so tests (and future
 * callers) control PostgreSQL reachability instead of the app reaching out
 * itself. `/readyz` reports ready only when the checker resolves `true`.
 */
export function createApp({ ready }: CreateAppOptions): Hono {
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

  return app;
}
