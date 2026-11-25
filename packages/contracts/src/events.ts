import { z } from "zod";

import { providerErrorCodeSchema } from "./models.ts";

/**
 * §10 run event protocol, frozen once. WP-30 emits only the agent-level types;
 * the delegation, child and delivery types are declared so the union never
 * changes when WP-55 and the delivery channels arrive. Wire format: `id` is
 * the event store `seq`, `event` is the type and `data` is the JSON payload
 * (see `sseFrame`).
 */
export const runEventTypes = [
  "run.started",
  "message.delta",
  "message.completed",
  "thinking.delta",
  "tool.started",
  "tool.completed",
  "approval.requested",
  "approval.resolved",
  "usage",
  "delegation.started",
  "delegation.completed",
  "child.event",
  "delivery.updated",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;
export type RunEventType = (typeof runEventTypes)[number];

const runStartedSchema = z.strictObject({
  type: z.literal("run.started"),
  runId: z.uuid(),
  agentVersionId: z.uuid(),
  model: z.string().min(1),
});

const messageDeltaSchema = z.strictObject({
  type: z.literal("message.delta"),
  messageId: z.uuid(),
  text: z.string(),
});

const messageCompletedSchema = z.strictObject({
  type: z.literal("message.completed"),
  messageId: z.uuid(),
  content: z.string(),
});

const thinkingDeltaSchema = z.strictObject({
  type: z.literal("thinking.delta"),
  messageId: z.uuid(),
  text: z.string(),
});

const toolStartedSchema = z.strictObject({
  type: z.literal("tool.started"),
  toolCallId: z.uuid(),
  name: z.string().min(1),
  argsPreview: z.string(),
});

/** A completed tool call is terminal: it cannot end up queued or running. */
const toolCompletionStatusSchema = z.enum(["succeeded", "failed", "denied"]);

const toolCompletedSchema = z.strictObject({
  type: z.literal("tool.completed"),
  toolCallId: z.uuid(),
  status: toolCompletionStatusSchema,
  resultPreview: z.string(),
  durationMs: z.number().int().min(0),
});

const approvalRequestedSchema = z.strictObject({
  type: z.literal("approval.requested"),
  approvalId: z.uuid(),
  toolCallId: z.uuid(),
  summary: z.string(),
  expiresAt: z.string(),
});

const approvalDecisionSchema = z.enum(["approved", "denied", "expired"]);

const approvalResolvedSchema = z.strictObject({
  type: z.literal("approval.resolved"),
  approvalId: z.uuid(),
  decision: approvalDecisionSchema,
});

const usageSchema = z.strictObject({
  type: z.literal("usage"),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0),
});

const delegationStartedSchema = z.strictObject({
  type: z.literal("delegation.started"),
  childRunId: z.uuid(),
  memberSlug: z.string().min(1),
  memberName: z.string().min(1),
  task: z.string(),
});

/** Same as the tool one: a completed delegation is terminal. */
const delegationStatusSchema = z.enum(["succeeded", "failed", "cancelled"]);

const delegationCompletedSchema = z.strictObject({
  type: z.literal("delegation.completed"),
  childRunId: z.uuid(),
  status: delegationStatusSchema,
  outputPreview: z.string(),
  costUsd: z.number().min(0),
});

/** A finished group member surfaces its own events inside the parent run. */
const childEventSchema = z.lazy(() =>
  z.strictObject({
    type: z.literal("child.event"),
    childRunId: z.uuid(),
    event: runEventSchema,
  }),
);

const deliveryUpdatedSchema = z.strictObject({
  type: z.literal("delivery.updated"),
  channelKind: z.enum(["email", "whatsapp"]),
  status: z.enum(["pending", "sent", "delivered", "failed"]),
});

const runCompletedSchema = z.strictObject({
  type: z.literal("run.completed"),
  output: z.string(),
  finishedAt: z.string(),
});

/**
 * §10 run failure catalog, imported rather than redeclared: it was two lists
 * once and they drifted. The Spanish wording for each code lives in the apps,
 * never in the contract.
 */

const runFailedSchema = z.strictObject({
  type: z.literal("run.failed"),
  code: providerErrorCodeSchema,
  message: z.string(),
});

const runCancelledSchema = z.strictObject({
  type: z.literal("run.cancelled"),
});

const agentRunEventSchema = z.discriminatedUnion("type", [
  runStartedSchema,
  messageDeltaSchema,
  messageCompletedSchema,
  thinkingDeltaSchema,
  toolStartedSchema,
  toolCompletedSchema,
  approvalRequestedSchema,
  approvalResolvedSchema,
  usageSchema,
  delegationStartedSchema,
  delegationCompletedSchema,
  deliveryUpdatedSchema,
  runCompletedSchema,
  runFailedSchema,
  runCancelledSchema,
]);

export type RunEvent =
  | z.infer<typeof agentRunEventSchema>
  | {
      type: "child.event";
      childRunId: string;
      event: RunEvent;
    };

// The annotation breaks the recursive inference that `z.lazy` needs.
export const runEventSchema: z.ZodType<RunEvent> = z.discriminatedUnion(
  "type",
  [...agentRunEventSchema.options, childEventSchema],
);

/** The exact SSE wire text for one event: three lines plus the blank line. */
export const sseFrame = (event: RunEvent, seq: number): string =>
  `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
