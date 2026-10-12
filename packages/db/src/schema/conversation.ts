import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { agent } from "./agent.js";

/** A thread of messages between a user and an agent. */
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    title: text("title"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("conversation_workspace_id_idx").on(table.workspaceId)],
);
