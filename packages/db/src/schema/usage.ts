import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { createId } from "../id.js";
import { agent } from "./agent.js";
import { spendLimitAction, spendLimitScope } from "./enums.js";
import { run } from "./run.js";

/**
 * Tokens and cost of one assistant message. The cost comes from pi-ai's
 * `usage.cost`, in USD with numeric(14,6).
 */
export const usageRecord = pgTable(
  "usage_record",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("usage_record_workspace_id_idx").on(table.workspaceId),
    index("usage_record_workspace_id_created_at_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check(
      "usage_record_tokens_non_negative",
      sql`input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0`,
    ),
    check("usage_record_cost_non_negative", sql`cost_usd >= 0`),
  ],
);

/** Spending budget that can warn or block a workspace, agent or credential. */
export const spendLimit = pgTable(
  "spend_limit",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    scope: spendLimitScope("scope").notNull(),
    // NULL for `workspace` scope (the workspace_id column carries the id).
    scopeId: uuid("scope_id"),
    monthlyUsd: numeric("monthly_usd", { precision: 14, scale: 6 }).notNull(),
    action: spendLimitAction("action").notNull(),
  },
  (table) => [
    index("spend_limit_workspace_id_idx").on(table.workspaceId),
    check("spend_limit_monthly_usd_positive", sql`monthly_usd > 0`),
  ],
);
