import {
  conversationIdParamSchema,
  createConversationRequestSchema,
  listConversationsRequestSchema,
  listMessagesRequestSchema,
  renameConversationRequestSchema,
} from "@middleware/contracts";
import type { ConversationService } from "@middleware/core";
import { type Context, Hono } from "hono";

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

/** Thin handlers: parse, call the use case, return its result as is. */
function conversationHandlers(conversations: ConversationService) {
  return {
    list: async (c: Context<WorkspaceEnv>) => {
      const { cursor } = listConversationsRequestSchema.parse(c.req.query());
      return c.json(
        await conversations.listConversations(c.get("workspaceId"), cursor),
      );
    },

    create: async (c: Context<WorkspaceEnv>) => {
      const input = createConversationRequestSchema.parse(await readJson(c));
      return c.json(
        await conversations.createConversation(c.get("workspaceId"), input),
        201,
      );
    },

    rename: async (c: Context<WorkspaceEnv>) => {
      const input = renameConversationRequestSchema.parse(await readJson(c));
      return c.json(
        await conversations.renameConversation(
          c.get("workspaceId"),
          idOf(c),
          input,
        ),
      );
    },

    archive: async (c: Context<WorkspaceEnv>) => {
      await conversations.archiveConversation(c.get("workspaceId"), idOf(c));
      return c.body(null, 204);
    },

    history: async (c: Context<WorkspaceEnv>) => {
      const { cursor } = listMessagesRequestSchema.parse(c.req.query());
      return c.json(
        await conversations.listMessages(c.get("workspaceId"), idOf(c), cursor),
      );
    },
  } satisfies Record<string, (c: Context<WorkspaceEnv>) => Promise<Response>>;
}

/**
 * The conversation CRUD and the paginated history of §10, all behind the
 * session and composed over the core use case (T10): every cross-tenant
 * check lives behind the service and its repos. Writes check the origin
 * (S10). Errors go to the app's `onError`.
 */
export function conversationRoutes(
  auth: SessionReader,
  conversations: ConversationService,
  allowedOrigins: readonly string[],
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const session = requireWorkspace(auth);
  // S10: writes check the origin; reads do not.
  const write = requireOrigin(allowedOrigins);
  const handle = conversationHandlers(conversations);

  app.get("/api/conversations", session, handle.list);
  app.post("/api/conversations", session, write, handle.create);
  app.patch("/api/conversations/:id", session, write, handle.rename);
  app.delete("/api/conversations/:id", session, write, handle.archive);
  app.get("/api/conversations/:id/messages", session, handle.history);

  return app;
}
