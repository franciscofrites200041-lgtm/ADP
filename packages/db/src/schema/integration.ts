import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { integrationProvider, integrationStatus } from "./enums.js";

/**
 * An external OAuth account connected to the workspace (MVP: Google). The
 * refresh token is encrypted like provider credentials; the access token lives
 * only in memory.
 */
export const integration = pgTable(
  "integration",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    provider: integrationProvider("provider").notNull(),
    accountEmail: varchar("account_email", { length: 255 }).notNull(),
    scopes: text("scopes").array().notNull(),
    refreshCiphertext: text("refresh_ciphertext").notNull(),
    refreshIv: text("refresh_iv").notNull(),
    refreshAuthTag: text("refresh_auth_tag").notNull(),
    refreshKekVersion: varchar("refresh_kek_version", { length: 64 }).notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    status: integrationStatus("status").notNull().default("connected"),
    connectedBy: uuid("connected_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("integration_workspace_id_idx").on(table.workspaceId)],
);
