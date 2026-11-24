import type {
  Conversation,
  ConversationDraft,
} from "../domain/conversation.ts";

/** Options of `ConversationRepo.listByWorkspace`. */
export type ConversationListOptions = {
  /** `false` hides conversations with `archivedAt` set (logical delete, §7). */
  includeArchived: boolean;
};

/**
 * Every method scopes by `workspaceId` first (S4): the id always comes from
 * the session, never from the request, so another workspace's conversation
 * reads as missing, never as forbidden.
 */
export type ConversationRepo = {
  /** Inserts a conversation; the draft's `id` is caller-generated (§7). */
  insert(workspaceId: string, draft: ConversationDraft): Promise<Conversation>;
  findById(workspaceId: string, id: string): Promise<Conversation | null>;
  /** Newest first (ids are UUIDv7). */
  listByWorkspace(
    workspaceId: string,
    options: ConversationListOptions,
  ): Promise<Conversation[]>;
  /** Sets the title and stamps `updatedAt`; `null` when missing or archived. */
  rename(
    workspaceId: string,
    id: string,
    title: string,
  ): Promise<Conversation | null>;
  /** Logical delete (§7): stamps `archivedAt`; `null` when missing or archived. */
  archive(
    workspaceId: string,
    id: string,
    at: Date,
  ): Promise<Conversation | null>;
};
