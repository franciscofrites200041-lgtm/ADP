import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type ApiEnv = z.infer<typeof envSchema>;

/**
 * Validates environment variables at the process boundary. The parsed URL is
 * returned to the caller for database initialization; it is never logged or
 * sent to clients.
 */
export function readEnv(env: NodeJS.ProcessEnv): ApiEnv {
  return envSchema.parse(env);
}
