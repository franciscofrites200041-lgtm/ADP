import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { providerCredential } from "./credential.js";

/** Global catalog of reusable agent templates, loaded by seed (WP-21). */
export const agentTemplate = pgTable("agent_template", {
  id: uuid("id").primaryKey().$defaultFn(createId),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  instructions: text("instructions").notNull(),
  suggestedParams: jsonb("suggested_params").notNull(),
  suggestedTools: jsonb("suggested_tools").notNull(),
});

/**
 * An agent's mutable identity. Its content lives in immutable `agent_version`
 * rows; `current_version_id` is a denormalized pointer set after the first
 * version is inserted (no FK to avoid a circular insert dependency).
 */
export const agent = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    currentVersionId: uuid("current_version_id"),
    templateId: uuid("template_id").references(() => agentTemplate.id),
    createdBy: uuid("created_by"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [index("agent_workspace_id_idx").on(table.workspaceId)],
);

/** Immutable snapshot of an agent's instructions, model, params and tools. */
export const agentVersion = pgTable(
  "agent_version",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    workspaceId: uuid("workspace_id").notNull(),
    version: integer("version").notNull(),
    instructions: text("instructions").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    credentialId: uuid("credential_id").references(() => providerCredential.id),
    params: jsonb("params").notNull(),
    tools: jsonb("tools").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_version_workspace_id_idx").on(table.workspaceId),
    unique("agent_version_agent_id_version_unique").on(
      table.agentId,
      table.version,
    ),
    check("agent_version_version_positive", sql`version > 0`),
  ],
);
