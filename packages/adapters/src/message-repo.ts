import type {
  Message,
  MessageDraft,
  MessageListOptions,
  MessageRepo,
} from "@middleware/core";
import { DomainError, NotFoundError } from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";

const messageTable = schema.message;

/**
 * `content` is jsonb at the driver but plain text in the domain: validated
 * here, at the boundary, instead of cast to a type we hope the row honours
 * (same rule as the run repo's jsonb columns).
 */
const contentSchema = z.string();

/** Page size: a positive integer, capped at a sane bound (§10). */
const limitSchema = z.number().int().positive().max(1000);

const toMessage = (row: typeof messageTable.$inferSelect): Message => ({
  id: row.id,
  workspaceId: row.workspaceId,
  conversationId: row.conversationId,
  runId: row.runId,
  role: row.role,
  content: contentSchema.parse(row.content),
  createdAt: row.createdAt,
});

/** Full-precision timestamp of the row, for the cursor anchor (§7). */
const cursorAnchor = sql<string>`${messageTable.createdAt}::text`;

/**
 * A malformed cursor is the caller's mistake, so it maps to the API's
 * `invalid_request` code (§10) through the domain error base.
 */
export class MessageCursorError extends DomainError {
  constructor(detail = "malformed_cursor") {
    super("invalid_request", detail);
  }
}

/** Payload the opaque cursor carries: a timestamp plus the message id. */
const cursorPayloadSchema = z.strictObject({
  t: z.string().min(1),
  id: z.uuid(),
});

/**
 * Anchor of a cursor. The timestamp is the row's full-precision
 * `created_at` text: the column is microseconds (§7) while a domain `Date`
 * only carries milliseconds, so a millisecond anchor would page rows twice.
 */
export type MessageCursorAnchor = {
  createdAt: string;
  id: string;
};

/** Opaque cursor: base64 of the `(createdAt, id)` pair, never raw values. */
export const encodeMessageCursor = (anchor: MessageCursorAnchor): string => {
  const payload = { t: anchor.createdAt, id: anchor.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

/** Rejects anything that is not a cursor `encodeMessageCursor` produced. */
export const decodeMessageCursor = (cursor: string): MessageCursorAnchor => {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new MessageCursorError();
  }
  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new MessageCursorError();
  return { createdAt: parsed.data.t, id: parsed.data.id };
};

/** Postgres adapter of `MessageRepo` over the `message` table. */
export function createMessageRepo(db: DbClient): MessageRepo {
  return {
    async append(workspaceId, draft: MessageDraft) {
      // The conversation must belong to the workspace (S4): a foreign id
      // must read as missing, never seed an orphan row.
      const [conversation] = await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.workspaceId, workspaceId),
            eq(schema.conversation.id, draft.conversationId),
          ),
        );
      if (!conversation) throw new NotFoundError();
      // Same rule for the run (S4): the FK proves it exists, not that it
      // is ours, so a foreign run id reads as missing.
      if (draft.runId !== null) {
        const [run] = await db
          .select({ id: schema.run.id })
          .from(schema.run)
          .where(
            and(
              eq(schema.run.workspaceId, workspaceId),
              eq(schema.run.id, draft.runId),
            ),
          );
        if (!run) throw new NotFoundError();
      }
      const [row] = await db
        .insert(messageTable)
        .values({
          id: draft.id,
          workspaceId,
          conversationId: draft.conversationId,
          runId: draft.runId,
          role: draft.role,
          content: draft.content,
        })
        .returning();
      if (!row) throw new Error("message insert returned no row");
      return toMessage(row);
    },

    async listByConversation(
      workspaceId,
      conversationId,
      options: MessageListOptions,
    ) {
      const limit = limitSchema.parse(options.limit ?? 100);
      const conditions = [
        eq(messageTable.workspaceId, workspaceId),
        eq(messageTable.conversationId, conversationId),
      ];
      if (options.after !== undefined) {
        const cursor = decodeMessageCursor(options.after);
        // Tuple compare: two messages sharing a timestamp still page in id
        // order, without gaps or repeats. The anchor goes back as a
        // full-precision timestamp text with an explicit cast.
        conditions.push(
          sql`(${messageTable.createdAt}, ${messageTable.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
        );
      }
      // One extra row detects the end without a second query. The anchor
      // text rides along because the mapped Date loses microseconds.
      const rows = await db
        .select({ ...getTableColumns(messageTable), anchor: cursorAnchor })
        .from(messageTable)
        .where(and(...conditions))
        .orderBy(asc(messageTable.createdAt), asc(messageTable.id))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        messages: page.map(toMessage),
        nextCursor:
          hasMore && last
            ? encodeMessageCursor({ createdAt: last.anchor, id: last.id })
            : null,
      };
    },
  };
}
