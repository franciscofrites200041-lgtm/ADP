import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
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
import { agent, agentVersion } from "./agent.js";
import { apiToken } from "./api-token.js";
import { conversation } from "./conversation.js";
import {
  approvalDecision,
  runStatus,
  runTrigger,
  scheduleTargetType,
  toolCallStatus,
} from "./enums.js";
import { agentGroup } from "./group.js";

/**
 * A single agent execution, from input to final response. Child runs created
 * by delegation point at the root via `parent_run_id`/`root_run_id`.
 */
export const run = pgTable(
  "run",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agent.id),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersion.id),
    groupId: uuid("group_id").references(() => agentGroup.id),
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => run.id),
    rootRunId: uuid("root_run_id")
      .notNull()
      .references((): AnyPgColumn => run.id),
    conversationId: uuid("conversation_id").references(() => conversation.id),
    trigger: runTrigger("trigger").notNull(),
    status: runStatus("status").notNull().default("queued"),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key"),
    apiTokenId: uuid("api_token_id").references(() => apiToken.id),
    scheduleId: uuid("schedule_id").references((): AnyPgColumn => schedule.id),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("run_workspace_id_idx").on(table.workspaceId),
    index("run_workspace_id_status_idx").on(table.workspaceId, table.status),
    index("run_conversation_id_queued_at_idx").on(
      table.conversationId,
      table.queuedAt,
    ),
    index("run_root_run_id_idx").on(table.rootRunId),
    index("run_group_id_queued_at_idx").on(table.groupId, table.queuedAt),
    // NULL idempotency_key rows are distinct in Postgres, so this enforces
    // uniqueness only when a key is present (matching §7).
    unique("run_workspace_id_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
  ],
);

/** Append-only, reconnectable stream of everything that happens in a run. */
export const runEvent = pgTable(
  "run_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    workspaceId: uuid("workspace_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("run_event_workspace_id_idx").on(table.workspaceId),
    // Unique index doubles as the mandated `run_event(run_id, seq)` index.
    unique("run_event_run_id_seq_unique").on(table.runId, table.seq),
  ],
);

/** One tool invocation within a run, deduplicated by provider tool call id. */
export const toolCall = pgTable(
  "tool_call",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    workspaceId: uuid("workspace_id").notNull(),
    providerToolCallId: text("provider_tool_call_id").notNull(),
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    args: jsonb("args").notNull(),
    status: toolCallStatus("status").notNull().default("pending"),
    resultSummary: text("result_summary"),
    isError: boolean("is_error").notNull().default(false),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("tool_call_workspace_id_idx").on(table.workspaceId),
    index("tool_call_run_id_idx").on(table.runId),
    unique("tool_call_run_id_provider_tool_call_id_unique").on(
      table.runId,
      table.providerToolCallId,
    ),
    check("tool_call_duration_non_negative", sql`duration_ms >= 0`),
  ],
);

/** Human confirmation requested before a tool with side effects runs. */
export const approval = pgTable(
  "approval",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => run.id),
    toolCallId: uuid("tool_call_id")
      .notNull()
      .references(() => toolCall.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decision: approvalDecision("decision"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [index("approval_workspace_id_idx").on(table.workspaceId)],
);

/** A cron rule that creates runs of an agent or group with a fixed input. */
export const schedule = pgTable(
  "schedule",
  {
    id: uuid("id").primaryKey().$defaultFn(createId),
    workspaceId: uuid("workspace_id").notNull(),
    targetType: scheduleTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    cron: varchar("cron", { length: 100 }).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Argentina/Buenos_Aires"),
    input: jsonb("input").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunId: uuid("last_run_id").references((): AnyPgColumn => run.id),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
  },
  (table) => [index("schedule_workspace_id_idx").on(table.workspaceId)],
);
