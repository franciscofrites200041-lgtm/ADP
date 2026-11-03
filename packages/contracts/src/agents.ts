import { z } from "zod";

import { credentialIdParamSchema } from "./credentials.ts";
import { providerIdSchema } from "./providers.ts";

/** Same rules as the credential alias: no control characters, no NUL. */
export const agentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\p{Cc}]+$/u);

export const agentDescriptionSchema = z
  .string()
  .trim()
  .max(2000)
  .regex(/^[^\p{Cc}]+$/u);

/**
 * Generation settings of one version. Everything is optional: a provider fills
 * its own defaults, and we never invent numbers on the user's behalf.
 */
export const agentParamsSchema = z.strictObject({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type AgentParams = z.infer<typeof agentParamsSchema>;

/** Tool ids are ours, not free text: the run engine resolves them (WP-30). */
export const agentToolsSchema = z.array(z.string().trim().min(1).max(64));

const agentId = credentialIdParamSchema.shape.id;

/**
 * The content of one version. Immutable once written: editing an agent inserts
 * a new row, which is what makes "restore" a new version too (S4).
 */
export const agentVersionInputSchema = z.strictObject({
  instructions: z.string().trim().min(1).max(20_000),
  providerId: providerIdSchema,
  modelId: z.string().trim().min(1).max(200),
  credentialId: agentId,
  params: agentParamsSchema,
  tools: agentToolsSchema,
});
export type AgentVersionInput = z.infer<typeof agentVersionInputSchema>;

export const createAgentRequestSchema = z.strictObject({
  name: agentNameSchema,
  description: agentDescriptionSchema.optional(),
  version: agentVersionInputSchema,
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z.strictObject({
  name: agentNameSchema.optional(),
  description: agentDescriptionSchema.nullable().optional(),
  /** Present means "save this as a new version". */
  version: agentVersionInputSchema.optional(),
});
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const restoreAgentVersionRequestSchema = z.strictObject({
  versionId: agentId,
});
export type RestoreAgentVersionRequest = z.infer<
  typeof restoreAgentVersionRequestSchema
>;

export const duplicateAgentRequestSchema = z.strictObject({
  name: agentNameSchema,
});
export type DuplicateAgentRequest = z.infer<typeof duplicateAgentRequestSchema>;

export const agentVersionResponseSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  instructions: z.string(),
  providerId: providerIdSchema,
  modelId: z.string(),
  credentialId: z.uuid(),
  params: agentParamsSchema,
  tools: agentToolsSchema,
  createdAt: z.string(),
});
export type AgentVersionResponse = z.infer<typeof agentVersionResponseSchema>;

/** The agent with its current version flattened in: one read for the editor. */
export const agentResponseSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  currentVersion: agentVersionResponseSchema.nullable(),
  archivedAt: z.string().nullable(),
});
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const agentListResponseSchema = z.strictObject({
  agents: z.array(agentResponseSchema),
});
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;
