import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { agent } from "./agent.js";
import { agentGroupMode } from "./enums.js";

/**
 * A group of agents coordinated by a single coordinator agent. The
 * coordinator cannot also be a member of its own group.
 */
export const agentGroup = pgTable(
  "agent_group",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    goal: text("goal"),
    coordinatorAgentId: uuid("coordinator_agent_id")
      .notNull()
      .references(() => agent.id),
    mode: agentGroupMode("mode").notNull().default("coordinator"),
    maxDelegations: integer("max_delegations").notNull().default(8),
    maxCostUsd: numeric("max_cost_usd", { precision: 14, scale: 6 })
      .notNull()
      .default("0.500000"),
    createdBy: uuid("created_by"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_group_workspace_id_idx").on(table.workspaceId),
    check("agent_group_max_delegations_positive", sql`max_delegations > 0`),
    check("agent_group_max_cost_usd_positive", sql`max_cost_usd > 0`),
  ],
);

/** Membership of an agent in a group, with a delegation slug and description. */
export const agentGroupMember = pgTable(
  "agent_group_member",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => agentGroup.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    workspaceId: uuid("workspace_id").notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    roleDescription: text("role_description"),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.agentId] }),
    index("agent_group_member_workspace_id_idx").on(table.workspaceId),
    unique("agent_group_member_group_id_slug_unique").on(
      table.groupId,
      table.slug,
    ),
    check("agent_group_member_position_non_negative", sql`position >= 0`),
  ],
);
