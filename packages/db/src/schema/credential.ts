import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import {
  providerCredentialStatus,
  toolConnectionKind,
  toolConnectionMode,
} from "./enums.js";

/**
 * A provider API key, stored encrypted (AES-256-GCM with the workspace DEK).
 * The API key itself never leaves the backend; only alias/last4/status do.
 */
export const providerCredential = pgTable(
  "provider_credential",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    providerId: text("provider_id").notNull(),
    alias: varchar("alias", { length: 255 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    kekVersion: varchar("kek_version", { length: 64 }).notNull(),
    last4: varchar("last4", { length: 4 }),
    // Only meaningful for the `openai-compatible` provider.
    baseUrl: text("base_url"),
    status: providerCredentialStatus("status").notNull().default("unchecked"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("provider_credential_workspace_id_idx").on(table.workspaceId),
    unique("provider_credential_workspace_id_alias_unique").on(
      table.workspaceId,
      table.alias,
    ),
    check(
      "provider_credential_base_url_only_openai_compatible",
      sql`base_url IS NULL OR provider_id = 'openai-compatible'`,
    ),
  ],
);

/**
 * A reusable tool configuration for a workspace (search provider, HTTP
 * endpoint or remote MCP server). Secrets, when present, are encrypted exactly
 * like provider credentials.
 */
export const toolConnection = pgTable(
  "tool_connection",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    kind: toolConnectionKind("kind").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    config: jsonb("config").notNull(),
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    secretAuthTag: text("secret_auth_tag"),
    secretKekVersion: varchar("secret_kek_version", { length: 64 }),
    mode: toolConnectionMode("mode").notNull().default("read_only"),
    // Not enumerated in §7; kept free-form so the adapter can evolve it.
    status: text("status"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("tool_connection_workspace_id_idx").on(table.workspaceId)],
);
