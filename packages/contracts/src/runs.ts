import { z } from "zod";

/** The six run states of §5; `waiting_approval` pauses the executor. */
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const createRunRequestSchema = z.strictObject({
  agentId: z.uuid(),
  conversationId: z.uuid().optional(),
  input: z.string().trim().min(1),
  /** Run detached from the request stream (WP-50 owns background delivery). */
  background: z.boolean().optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/**
 * The public view of a run. `groupId` is deliberately absent: groups are
 * WP-55 and a field the API cannot honour yet would be a lie in the contract.
 */
export const runResponseSchema = z.strictObject({
  id: z.uuid(),
  agentId: z.uuid(),
  agentVersionId: z.uuid(),
  conversationId: z.uuid().nullable(),
  status: runStatusSchema,
  input: z.string(),
  output: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunResponse = z.infer<typeof runResponseSchema>;

export const runListResponseSchema = z.strictObject({
  runs: z.array(runResponseSchema),
});
export type RunListResponse = z.infer<typeof runListResponseSchema>;
