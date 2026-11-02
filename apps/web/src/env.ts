import { z } from "zod";

/**
 * Web-only environment, validated at the boundary. `/api/me` is reached through
 * this URL from Server Components; a malformed value fails on the first
 * request instead of looking like "every user is signed out".
 */
export const webEnvSchema = z.object({
  // http(s) only: this string is passed to `fetch`, so another scheme is a bug.
  API_INTERNAL_URL: z
    .url({ protocol: /^https?$/ })
    .default("http://localhost:3001"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function readWebEnv(env: Record<string, string | undefined>): WebEnv {
  return webEnvSchema.parse(env);
}
