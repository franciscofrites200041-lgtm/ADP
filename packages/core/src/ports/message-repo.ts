import type { Message, MessageDraft } from "../domain/conversation.ts";

/** Options of `MessageRepo.listByConversation`. */
export type MessageListOptions = {
  /**
   * Opaque cursor of the last message already seen (§10): the page starts
   * strictly after it. The format is an adapter detail; the port only
   * promises that the cursor it returns is accepted back here.
   */
  after?: string;
  /** Page size; defaults to 100. */
  limit?: number;
};

/** One page of history, ascending by creation (§10). */
export type MessagePage = {
  messages: Message[];
  /** `null` when the page reached the end of the conversation. */
  nextCursor: string | null;
};

/**
 * Every method scopes by `workspaceId` first (S4): the id always comes from
 * the session, never from the request, so another workspace's messages read
 * as missing, never as forbidden.
 */
export type MessageRepo = {
  /**
   * Appends a message; the draft's `id` is caller-generated (§7). It fails
   * when the conversation does not exist in the workspace, so a foreign id
   * can never seed an orphan row.
   */
  append(workspaceId: string, message: MessageDraft): Promise<Message>;
  /**
   * History ascending by creation (§10). The page is deterministic even
   * when several messages share a timestamp: ties break by id, and the
   * cursor is opaque, so raw timestamps never cross the boundary.
   */
  listByConversation(
    workspaceId: string,
    conversationId: string,
    options: MessageListOptions,
  ): Promise<MessagePage>;
};
