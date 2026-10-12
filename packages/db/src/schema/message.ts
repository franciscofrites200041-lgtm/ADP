import { index, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { conversation } from "./conversation.js";
import { messageRole } from "./enums.js";
import { run } from "./run.js";

/**
 * A message in a conversation, persisted in the pi-ai message format.
 * `run_id` links the message to the execution that produced it.
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id),
    runId: uuid("run_id").references(() => run.id),
    role: messageRole("role").notNull(),
    content: jsonb("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("message_workspace_id_idx").on(table.workspaceId),
    index("message_conversation_id_created_at_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
