import { z } from "zod";

/** `GET /api/me`: the signed-in user and their active workspace (§10). */
export const meResponseSchema = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
  }),
  workspace: z.strictObject({ id: z.uuid() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
