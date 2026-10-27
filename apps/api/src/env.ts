import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
});

export type ApiEnv = z.infer<typeof envSchema>;

/**
 * Validates environment variables at the process boundary. Values are
 * returned to the caller for initialization; they are never logged or sent
 * to clients.
 */
export function readEnv(env: NodeJS.ProcessEnv): ApiEnv {
  return envSchema.parse(env);
}
