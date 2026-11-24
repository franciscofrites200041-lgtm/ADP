import { z } from "zod";

/** Path param for the per-conversation routes of §10. */
export const conversationIdParamSchema = z.strictObject({ id: z.uuid() });

export const createConversationRequestSchema = z.strictObject({
  agentId: z.uuid(),
});
export type CreateConversationRequest = z.infer<
  typeof createConversationRequestSchema
>;

// Same rules as the credential alias: no control characters, no NUL.
const conversationTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\p{Cc}]+$/u);

export const renameConversationRequestSchema = z.strictObject({
  title: conversationTitleSchema,
});
export type RenameConversationRequest = z.infer<
  typeof renameConversationRequestSchema
>;

/** Both list routes of §10 are cursor-paginated through a query param. */
export const listConversationsRequestSchema = z.strictObject({
  cursor: z.string().optional(),
});
export type ListConversationsRequest = z.infer<
  typeof listConversationsRequestSchema
>;

export const listMessagesRequestSchema = z.strictObject({
  cursor: z.string().optional(),
});
export type ListMessagesRequest = z.infer<typeof listMessagesRequestSchema>;

export const conversationResponseSchema = z.strictObject({
  id: z.uuid(),
  agentId: z.uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

export const conversationListResponseSchema = z.strictObject({
  conversations: z.array(conversationResponseSchema),
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<
  typeof conversationListResponseSchema
>;

/**
 * One chat message. `role` mirrors the `message.role` DB enum; content is the
 * plain text the UI renders (the pi-ai blocks stay in the database).
 */
export const messageResponseSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(["user", "assistant", "tool_result"]),
  content: z.string(),
  createdAt: z.string(),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;

/** `GET /api/conversations/:id/messages`, paginated (§10). */
export const messageListResponseSchema = z.strictObject({
  messages: z.array(messageResponseSchema),
  nextCursor: z.string().nullable(),
});
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
