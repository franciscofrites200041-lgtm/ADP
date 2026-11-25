import type {
  ConversationListResponse,
  ConversationResponse,
  CreateConversationRequest,
  MessageListResponse,
  MessageResponse,
  RenameConversationRequest,
} from "@middleware/contracts";
import type { Conversation, Message } from "../domain/conversation.ts";
import { DomainError, NotFoundError } from "../domain/errors.ts";
import type { ConversationRepo } from "../ports/conversation-repo.ts";
import type { IdGen } from "../ports/id-gen.ts";
import type { MessageRepo } from "../ports/message-repo.ts";

/** Page size of the two list flows (§10); the cursor walks the rest. */
const PAGE_SIZE = 50;

/** Same shape `z.uuid()` accepts in the contracts: 8-4-4-4-12 hex digits. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payload the opaque conversations cursor carries: exactly one `id` key.
 * Validated by hand because `packages/core` declares no schema runtime; the
 * wire stays covered by the Zod schemas of the API boundary.
 */
const decodeConversationCursor = (cursor: string): string => {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new DomainError("invalid_request", "malformed_cursor");
  }
  const id =
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 1 &&
    "id" in payload
      ? payload.id
      : undefined;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new DomainError("invalid_request", "malformed_cursor");
  }
  return id;
};

const encodeConversationCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");

export type ConversationServiceDeps = {
  conversationRepo: ConversationRepo;
  messageRepo: MessageRepo;
  /** New conversation ids are generated here (§7). */
  idGen: IdGen;
};

/**
 * `workspaceId` always comes from the session, never from the request (S4),
 * so another workspace's conversation reads as missing, never as forbidden.
 */
export type ConversationService = {
  /** Newest first, one page of 50 and the cursor for the next one (§10). */
  listConversations(
    workspaceId: string,
    cursor?: string,
  ): Promise<ConversationListResponse>;
  createConversation(
    workspaceId: string,
    input: CreateConversationRequest,
  ): Promise<ConversationResponse>;
  renameConversation(
    workspaceId: string,
    conversationId: string,
    input: RenameConversationRequest,
  ): Promise<ConversationResponse>;
  /** Logical delete (§7): stamps `archivedAt`; missing reads as 404. */
  archiveConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<void>;
  /** One page of history, ascending by creation (§10). */
  listMessages(
    workspaceId: string,
    conversationId: string,
    cursor?: string,
  ): Promise<MessageListResponse>;
};

const toConversationResponse = (
  conversation: Conversation,
): ConversationResponse => ({
  id: conversation.id,
  agentId: conversation.agentId,
  title: conversation.title,
  createdAt: conversation.createdAt.toISOString(),
  updatedAt: conversation.updatedAt.toISOString(),
});

const toMessageResponse = (message: Message): MessageResponse => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
});

export function createConversationService({
  conversationRepo,
  messageRepo,
  idGen,
}: ConversationServiceDeps): ConversationService {
  const requireConversation = async (
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> => {
    const conversation = await conversationRepo.findById(
      workspaceId,
      conversationId,
    );
    if (conversation === null) throw new NotFoundError();
    return conversation;
  };

  return {
    async listConversations(workspaceId, cursor) {
      const all = await conversationRepo.listByWorkspace(workspaceId, {
        includeArchived: false,
      });
      // The cursor is the id of the last row of the previous page.
      let start = 0;
      if (cursor !== undefined) {
        const anchorId = decodeConversationCursor(cursor);
        const index = all.findIndex(
          (conversation) => conversation.id === anchorId,
        );
        if (index === -1) {
          throw new DomainError("invalid_request", "unknown_cursor");
        }
        start = index + 1;
      }
      const page = all.slice(start, start + PAGE_SIZE);
      const last = page.at(-1);
      return {
        conversations: page.map(toConversationResponse),
        nextCursor:
          last !== undefined && start + PAGE_SIZE < all.length
            ? encodeConversationCursor(last.id)
            : null,
      };
    },

    async createConversation(workspaceId, input) {
      // The repo proves the agent belongs to the workspace before writing
      // (S4): a foreign agent id reads as missing, never leaks a row in.
      const created = await conversationRepo.insert(workspaceId, {
        id: idGen.newId(),
        agentId: input.agentId,
        title: null,
      });
      return toConversationResponse(created);
    },

    async renameConversation(workspaceId, conversationId, input) {
      const renamed = await conversationRepo.rename(
        workspaceId,
        conversationId,
        input.title,
      );
      if (renamed === null) throw new NotFoundError();
      return toConversationResponse(renamed);
    },

    async archiveConversation(workspaceId, conversationId) {
      const archived = await conversationRepo.archive(
        workspaceId,
        conversationId,
        new Date(),
      );
      if (archived === null) throw new NotFoundError();
    },

    async listMessages(workspaceId, conversationId, cursor) {
      // The check is what makes a foreign conversation 404 instead of an
      // empty page (S4); the repo cursor carries the rest (§10).
      await requireConversation(workspaceId, conversationId);
      const page = await messageRepo.listByConversation(
        workspaceId,
        conversationId,
        cursor === undefined
          ? { limit: PAGE_SIZE }
          : { after: cursor, limit: PAGE_SIZE },
      );
      return {
        messages: page.messages.map(toMessageResponse),
        nextCursor: page.nextCursor,
      };
    },
  };
}
