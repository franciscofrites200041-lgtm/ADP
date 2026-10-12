import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { apiToken } from "./api-token.js";

/**
 * Immutable audit trail of credential, token, integration, channel and
 * approval changes. `actor_user_id` references the Better Auth user (WP-03),
 * so it carries no FK here.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorTokenId: uuid("actor_token_id").references(() => apiToken.id),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 100 }).notNull(),
    targetId: uuid("target_id").notNull(),
    metadata: jsonb("metadata").notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("audit_log_workspace_id_idx").on(table.workspaceId)],
);
