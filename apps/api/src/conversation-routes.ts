import {
  type ConversationResponse,
  conversationIdParamSchema,
  createConversationRequestSchema,
  listConversationsRequestSchema,
  listMessagesRequestSchema,
  type MessageResponse,
  renameConversationRequestSchema,
} from "@middleware/contracts";
import type {
  Conversation,
  ConversationRepo,
  IdGen,
  Message,
  MessageRepo,
} from "@middleware/core";
import { DomainError, NotFoundError } from "@middleware/core";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { requireOrigin } from "./origin.ts";
import {
  requireWorkspace,
  type SessionReader,
  type WorkspaceEnv,
} from "./workspace.ts";

// Malformed JSON becomes `undefined`, rejected as invalid_request.
const readJson = (c: Context): Promise<unknown> =>
  c.req.json().catch(() => undefined);

const idOf = (c: Context) => conversationIdParamSchema.parse(c.req.param()).id;

/** Page size of the two list routes (§10); the cursor walks the rest. */
const PAGE_SIZE = 50;

/** The conversations cursor is opaque: base64 of the last id on the page. */
const conversationCursorSchema = z.strictObject({ id: z.uuid() });

const encodeConversationCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");

const decodeConversationCursor = (cursor: string): string => {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new DomainError("invalid_request", "malformed_cursor");
  }
  return conversationCursorSchema.parse(payload).id;
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

/**
 * The conversation flows of §10, composed over the storage ports: there is
 * no conversation use case in core yet, so the routes orchestrate the repos
 * directly and every write goes through their own cross-tenant checks (S4).
 */
export type ConversationRoutesDeps = {
  conversations: ConversationRepo;
  messages: MessageRepo;
  /** New conversation ids are generated here (§7). */
  idGen: IdGen;
};

/** Thin handlers: parse, call the port, map the domain row to the contract. */
function conversationHandlers(deps: ConversationRoutesDeps) {
  return {
    list: async (c: Context<WorkspaceEnv>) => {
      const { cursor } = listConversationsRequestSchema.parse(c.req.query());
      const all = await deps.conversations.listByWorkspace(
        c.get("workspaceId"),
        { includeArchived: false },
      );
      // Newest first; the cursor is the id of the last page's last row.
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
      const nextCursor =
        last !== undefined && start + PAGE_SIZE < all.length
          ? encodeConversationCursor(last.id)
          : null;
      return c.json({
        conversations: page.map(toConversationResponse),
        nextCursor,
      });
    },

    create: async (c: Context<WorkspaceEnv>) => {
      const input = createConversationRequestSchema.parse(await readJson(c));
      const created = await deps.conversations.insert(c.get("workspaceId"), {
        id: deps.idGen.newId(),
        agentId: input.agentId,
        title: null,
      });
      return c.json(toConversationResponse(created), 201);
    },

    rename: async (c: Context<WorkspaceEnv>) => {
      const input = renameConversationRequestSchema.parse(await readJson(c));
      const renamed = await deps.conversations.rename(
        c.get("workspaceId"),
        idOf(c),
        input.title,
      );
      if (renamed === null) throw new NotFoundError();
      return c.json(toConversationResponse(renamed));
    },

    archive: async (c: Context<WorkspaceEnv>) => {
      const archived = await deps.conversations.archive(
        c.get("workspaceId"),
        idOf(c),
        new Date(),
      );
      if (archived === null) throw new NotFoundError();
      return c.body(null, 204);
    },

    history: async (c: Context<WorkspaceEnv>) => {
      const { cursor } = listMessagesRequestSchema.parse(c.req.query());
      const workspaceId = c.get("workspaceId");
      const id = idOf(c);
      // The check is what makes a foreign conversation 404 instead of an
      // empty page (S4).
      const conversation = await deps.conversations.findById(workspaceId, id);
      if (conversation === null) throw new NotFoundError();
      // One page at a time; the cursor carries the rest (§10).
      const options: { after?: string; limit: number } =
        cursor === undefined
          ? { limit: PAGE_SIZE }
          : { after: cursor, limit: PAGE_SIZE };
      const page = await deps.messages.listByConversation(
        workspaceId,
        id,
        options,
      );
      return c.json({
        messages: page.messages.map(toMessageResponse),
        nextCursor: page.nextCursor,
      });
    },
  } satisfies Record<string, (c: Context<WorkspaceEnv>) => Promise<Response>>;
}

/**
 * The conversation CRUD and the paginated history of §10, all behind the
 * session; writes check the origin (S10). Errors go to the app's `onError`.
 */
export function conversationRoutes(
  auth: SessionReader,
  deps: ConversationRoutesDeps,
  allowedOrigins: readonly string[],
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const session = requireWorkspace(auth);
  // S10: writes check the origin; reads do not.
  const write = requireOrigin(allowedOrigins);
  const handle = conversationHandlers(deps);

  app.get("/api/conversations", session, handle.list);
  app.post("/api/conversations", session, write, handle.create);
  app.patch("/api/conversations/:id", session, write, handle.rename);
  app.delete("/api/conversations/:id", session, write, handle.archive);
  app.get("/api/conversations/:id/messages", session, handle.history);

  return app;
}
