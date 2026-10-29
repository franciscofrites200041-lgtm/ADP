import { assertNoProviderKeys, keyringFromEnv } from "@middleware/adapters";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  MW_MASTER_KEY: z.string().min(1),
  MW_MASTER_KEY_VERSION: z.string().min(1),
  MW_MASTER_KEY_PREVIOUS: z.string().optional(),
});

export type ApiEnv = z.infer<typeof envSchema>;

/**
 * Validates environment variables at the process boundary. Values are
 * returned to the caller for initialization; they are never logged or sent
 * to clients. Provider credential variables are refused outright (S5) and
 * the master key must decode to 32 bytes (S1).
 */
export function readEnv(env: NodeJS.ProcessEnv): ApiEnv {
  assertNoProviderKeys(env);
  const parsed = envSchema.parse(env);
  keyringFromEnv(env);
  return parsed;
}
