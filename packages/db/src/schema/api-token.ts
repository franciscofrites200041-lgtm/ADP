import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { agent } from "./agent.js";

/**
 * A first-party API token (`mw_live_…`). Only the SHA-256 hash and the visible
 * prefix are stored; the full token is shown exactly once.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    // NULL means the token can act on every agent in the workspace.
    agentId: uuid("agent_id").references(() => agent.id),
    name: varchar("name", { length: 255 }).notNull(),
    prefix: varchar("prefix", { length: 8 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
  },
  (table) => [index("api_token_workspace_id_idx").on(table.workspaceId)],
);
