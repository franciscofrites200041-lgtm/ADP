import { createMiddleware } from "hono/factory";

import { errorResponse } from "./http-errors.ts";

/** The browser origin of a request: `Origin`, else the `Referer`'s origin. */
function requestOrigin(c: {
  req: { header(name: string): string | undefined };
}): string | null {
  const origin = c.req.header("origin");
  if (origin) return origin;
  const referer = c.req.header("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * S10: write routes validate the request origin against the app's own origin,
 * so a form posted from another site cannot ride the session cookie. Reads do
 * not need it.
 */
export function requireOrigin(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return createMiddleware(async (c, next) => {
    const origin = requestOrigin(c);
    if (!origin || !allowed.has(origin)) {
      return errorResponse(c, "forbidden");
    }
    await next();
  });
}
