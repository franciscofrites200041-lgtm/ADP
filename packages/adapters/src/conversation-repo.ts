import type {
  Conversation,
  ConversationDraft,
  ConversationListOptions,
  ConversationRepo,
} from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, desc, eq, isNull } from "drizzle-orm";

const conversationTable = schema.conversation;

const toConversation = (
  row: typeof conversationTable.$inferSelect,
): Conversation => ({
  id: row.id,
  workspaceId: row.workspaceId,
  agentId: row.agentId,
  title: row.title,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  archivedAt: row.archivedAt,
});

/** Only rows of the workspace that are not archived yet (§7, S4). */
const live = (workspaceId: string, id: string) =>
  and(
    eq(conversationTable.workspaceId, workspaceId),
    eq(conversationTable.id, id),
    isNull(conversationTable.archivedAt),
  );

/** Postgres adapter of `ConversationRepo` over the `conversation` table. */
export function createConversationRepo(db: DbClient): ConversationRepo {
  return {
    async insert(workspaceId, draft: ConversationDraft) {
      // The FK only proves the agent exists, not that it is ours (S4): the
      // agent row must belong to the workspace or the conversation reads
      // as missing instead of leaking a foreign agent id in.
      const [agent] = await db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.workspaceId, workspaceId),
            eq(schema.agent.id, draft.agentId),
          ),
        );
      if (!agent) throw new NotFoundError();
      const [row] = await db
        .insert(conversationTable)
        .values({
          id: draft.id,
          workspaceId,
          agentId: draft.agentId,
          title: draft.title,
        })
        .returning();
      if (!row) throw new Error("conversation insert returned no row");
      return toConversation(row);
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(conversationTable)
        .where(live(workspaceId, id));
      return rows[0] ? toConversation(rows[0]) : null;
    },

    async listByWorkspace(workspaceId, options: ConversationListOptions) {
      const conditions = [eq(conversationTable.workspaceId, workspaceId)];
      if (!options.includeArchived) {
        conditions.push(isNull(conversationTable.archivedAt));
      }
      const rows = await db
        .select()
        .from(conversationTable)
        .where(and(...conditions))
        .orderBy(desc(conversationTable.id));
      return rows.map(toConversation);
    },

    async rename(workspaceId, id, title) {
      const rows = await db
        .update(conversationTable)
        .set({ title, updatedAt: new Date() })
        .where(live(workspaceId, id))
        .returning();
      return rows[0] ? toConversation(rows[0]) : null;
    },

    async archive(workspaceId, id, archivedAt) {
      const rows = await db
        .update(conversationTable)
        .set({ archivedAt })
        .where(live(workspaceId, id))
        .returning();
      return rows[0] ? toConversation(rows[0]) : null;
    },
  };
}
