import { type MeResponse, meResponseSchema } from "@middleware/contracts";
import { cookies } from "next/headers";

import { readWebEnv } from "../../env.ts";

/** The signed-in user and workspace, as `GET /api/me` reports it. */
export type Session = MeResponse;

/**
 * Server-side session lookup. Next.js never touches the database: this asks the
 * API and forwards the browser's cookie, so the answer is the API's (§11).
 * Returns null when there is no valid session.
 */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const { API_INTERNAL_URL } = readWebEnv(process.env);
  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/me`, {
      headers: { cookie: jar.toString() },
      cache: "no-store",
    });
    if (!response.ok) return null;
    // Validated, not cast: a 200 with an unexpected body means signed out.
    const parsed = meResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // The API being down must not crash the page; treat it as signed out.
    return null;
  }
}
