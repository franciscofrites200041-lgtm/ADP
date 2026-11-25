import type {
  Conversation,
  ConversationDraft,
  Message,
  MessageDraft,
} from "../domain/conversation.ts";
import { DomainError, NotFoundError } from "../domain/errors.ts";
import type {
  ConversationListOptions,
  ConversationRepo,
} from "../ports/conversation-repo.ts";
import type {
  MessageListOptions,
  MessagePage,
  MessageRepo,
} from "../ports/message-repo.ts";

/** Deterministic first instant; every stamp moves one second forward. */
const BASE_TIME = 1_700_000_000_000;

/**
 * Payload the opaque message cursor carries, mirrored from the Postgres
 * adapter: a full-precision timestamp text plus the row id.
 */
type MessageCursorAnchor = { t: string; id: string };

const encodeMessageCursor = (createdAt: Date, id: string): string => {
  const payload: MessageCursorAnchor = {
    t: createdAt.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};

const decodeMessageCursor = (cursor: string): MessageCursorAnchor => {
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new DomainError("invalid_request", "malformed_cursor");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("t" in payload) ||
    !("id" in payload) ||
    typeof payload.t !== "string" ||
    typeof payload.id !== "string"
  ) {
    throw new DomainError("invalid_request", "malformed_cursor");
  }
  return { t: payload.t, id: payload.id };
};

/** In-memory conversation store honouring `ConversationRepo` (§7). */
function createInMemoryConversationRepo(): ConversationRepo & {
  rows: Conversation[];
} {
  const rows: Conversation[] = [];
  let tick = 0;
  const stamp = () => new Date(BASE_TIME + tick++ * 1000);
  /** Only live rows of the workspace read back (S4, logical delete §7). */
  const find = (workspaceId: string, id: string) =>
    rows.find(
      (row) =>
        row.workspaceId === workspaceId &&
        row.id === id &&
        row.archivedAt === null,
    );

  return {
    rows,
    async insert(workspaceId, draft: ConversationDraft) {
      const now = stamp();
      const row: Conversation = {
        ...draft,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      rows.push(row);
      return { ...row };
    },
    async findById(workspaceId, id) {
      const row = find(workspaceId, id);
      return row ? { ...row } : null;
    },
    /** Newest first: ids are caller-generated and grow with time (§7). */
    async listByWorkspace(
      workspaceId,
      options: ConversationListOptions,
    ): Promise<Conversation[]> {
      return rows
        .filter(
          (row) =>
            row.workspaceId === workspaceId &&
            (options.includeArchived || row.archivedAt === null),
        )
        .sort((left, right) => right.id.localeCompare(left.id))
        .map((row) => ({ ...row }));
    },
    async rename(workspaceId, id, title) {
      const row = find(workspaceId, id);
      if (!row) return null;
      row.title = title;
      row.updatedAt = stamp();
      return { ...row };
    },
    async archive(workspaceId, id, at) {
      const row = find(workspaceId, id);
      if (!row) return null;
      row.archivedAt = at;
      return { ...row };
    },
  };
}

/**
 * In-memory message store honouring `MessageRepo`. It is wired to the
 * conversation repo it belongs to, because `append` must reject a
 * conversation that is not in the workspace instead of seeding an orphan
 * row; the Postgres adapter also validates the run through its FK.
 */
function createInMemoryMessageRepo(
  conversations: ConversationRepo,
): MessageRepo & { rows: Message[] } {
  const rows: Message[] = [];
  let tick = 0;
  const stamp = () => new Date(BASE_TIME + tick++ * 1000);
  /** Ascending by creation; ties break by id so a page never repeats (§10). */
  const ordered = (workspaceId: string, conversationId: string) =>
    rows
      .filter(
        (row) =>
          row.workspaceId === workspaceId &&
          row.conversationId === conversationId,
      )
      .sort((left, right) => {
        const byTime = left.createdAt.getTime() - right.createdAt.getTime();
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
      });

  return {
    rows,
    async append(workspaceId, draft: MessageDraft) {
      const conversation = await conversations.findById(
        workspaceId,
        draft.conversationId,
      );
      if (conversation === null) throw new NotFoundError();
      const row: Message = {
        ...draft,
        workspaceId,
        createdAt: stamp(),
      };
      rows.push(row);
      return { ...row };
    },
    async listByConversation(
      workspaceId,
      conversationId,
      options: MessageListOptions,
    ): Promise<MessagePage> {
      const limit = options.limit ?? 100;
      const all = ordered(workspaceId, conversationId);
      let start = 0;
      if (options.after !== undefined) {
        const anchor = decodeMessageCursor(options.after);
        const index = all.findIndex(
          (row) =>
            row.id === anchor.id && row.createdAt.toISOString() === anchor.t,
        );
        if (index === -1) {
          throw new DomainError("invalid_request", "unknown_cursor");
        }
        start = index + 1;
      }
      const page = all.slice(start, start + limit);
      const last = page.at(-1);
      const hasMore = start + limit < all.length;
      return {
        messages: page.map((row) => ({ ...row })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeMessageCursor(last.createdAt, last.id)
            : null,
      };
    },
  };
}

/** Both conversation ports wired together, for use case tests. */
export function createInMemoryConversationPorts(): {
  conversationRepo: ConversationRepo & { rows: Conversation[] };
  messageRepo: MessageRepo & { rows: Message[] };
} {
  const conversationRepo = createInMemoryConversationRepo();
  const messageRepo = createInMemoryMessageRepo(conversationRepo);
  return { conversationRepo, messageRepo };
}
