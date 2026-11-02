import { z } from "zod";

export const errorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "not_found",
  "alias_taken",
  "forbidden",
  "unknown",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Every API error: `message` is Spanish and safe to show to the user. */
export const errorBodySchema = z.strictObject({
  error: z.strictObject({ code: errorCodeSchema, message: z.string() }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
