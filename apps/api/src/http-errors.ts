import type { ErrorCode } from "@middleware/contracts";
import { DomainError } from "@middleware/core";
import type { Context, ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "pino";
import { z } from "zod";

import { errorMessages } from "./messages.ts";

const statusByCode: Record<ErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  alias_taken: 409,
  forbidden: 403,
  unknown: 500,
};

/** The §10 error shape. The message comes from `messages.ts`, never from the error. */
export function errorResponse(c: Context, code: ErrorCode): Response {
  return c.json(
    { error: { code, message: errorMessages[code] } },
    statusByCode[code],
  );
}

const codeOf = (error: unknown): ErrorCode => {
  if (error instanceof DomainError) return error.code;
  if (error instanceof z.ZodError) return "invalid_request";
  return "unknown";
};

// Only name and code: driver and Drizzle messages embed query parameters,
// which hold the sealed secret (S2).
const describe = (error: Error) => {
  const code: unknown = "code" in error ? error.code : undefined;
  return {
    errorName: error.name,
    ...(typeof code === "string" ? { errorCode: code } : {}),
  };
};

/** Hono `onError`: every thrown error becomes `{ error: { code, message } }`. */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return (error, c) => {
    const code = codeOf(error);
    if (code === "unknown") {
      logger.error(
        { ...describe(error), method: c.req.method, route: c.req.routePath },
        "request failed",
      );
    }
    return errorResponse(c, code);
  };
}
