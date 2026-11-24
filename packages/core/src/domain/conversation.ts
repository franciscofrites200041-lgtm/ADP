/**
 * How a message was authored. Mirrors the `message_role` enum in the database:
 * `packages/core` cannot import `@middleware/db`, so the union is repeated
 * here on purpose and the adapter rejects unknown values at the boundary.
 * `@middleware/contracts` does not export a `MessageRole` type (its
 * `messageResponseSchema` inlines the enum), so this is the canonical union
 * for the domain and the API maps it into the response schema.
 */
export type MessageRole = "user" | "assistant" | "tool_result";

/** A thread of messages between a user and an agent (§7). */
export type Conversation = {
  id: string;
  workspaceId: string;
  agentId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

/**
 * What `ConversationRepo.insert` needs: the `id` is caller-generated
 * (UUIDv7, §7) and the workspace comes from the method, never the draft.
 */
export type ConversationDraft = {
  id: string;
  agentId: string;
  title: string | null;
};

/** One message in a conversation, in the history the agent reads (§7). */
export type Message = {
  id: string;
  workspaceId: string;
  conversationId: string;
  /**
   * The execution that produced the message: `null` for a user message
   * created before its run finishes (S1).
   */
  runId: string | null;
  role: MessageRole;
  content: string;
  createdAt: Date;
};

/** What `MessageRepo.append` needs; the `id` is caller-generated. */
export type MessageDraft = {
  id: string;
  conversationId: string;
  runId: string | null;
  role: MessageRole;
  content: string;
};
