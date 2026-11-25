import { z } from "zod";

/**
 * The executor state the run engine checkpoints after each completed turn
 * (§5) and that a resume (WP-50) reads to continue without repeating work.
 * One message of the neutral transcript (D2): `text` carries the whole
 * message for `user`/`assistant`; `tool_result` also carries the call it
 * answers, so tool turns can replay once tools exist (WP-40).
 */
export const checkpointMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), text: z.string() }),
  z.strictObject({ role: z.literal("assistant"), text: z.string() }),
  z.strictObject({
    role: z.literal("tool_result"),
    text: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
  }),
]);

export type CheckpointMessage = z.infer<typeof checkpointMessageSchema>;

/**
 * The `run.checkpoint` column's payload: the transcript the next turn
 * streams from, ascending by position. Turn counts live in their own column
 * (`run.turns_completed`), not here.
 */
export const runCheckpointSchema = z.strictObject({
  transcript: z.array(checkpointMessageSchema),
});

export type RunCheckpoint = z.infer<typeof runCheckpointSchema>;
