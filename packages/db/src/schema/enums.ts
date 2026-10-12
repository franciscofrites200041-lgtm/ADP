import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enums for the product-owned data model (§7).
 *
 * Names use snake_case to match the generated enum types in PostgreSQL.
 */

export const providerCredentialStatus = pgEnum("provider_credential_status", [
  "unchecked",
  "valid",
  "invalid",
]);

export const toolConnectionKind = pgEnum("tool_connection_kind", [
  "web_search",
  "http",
  "mcp",
]);

export const toolConnectionMode = pgEnum("tool_connection_mode", [
  "read_only",
  "read_write",
]);

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "tool_result",
]);

export const runTrigger = pgEnum("run_trigger", [
  "chat",
  "api",
  "schedule",
  "manual",
  "delegation",
]);

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

export const toolCallStatus = pgEnum("tool_call_status", [
  "pending",
  "waiting_approval",
  "running",
  "succeeded",
  "failed",
  "denied",
]);

export const approvalDecision = pgEnum("approval_decision", [
  "approved",
  "denied",
  "expired",
]);

export const scheduleTargetType = pgEnum("schedule_target_type", [
  "agent",
  "group",
]);

export const spendLimitScope = pgEnum("spend_limit_scope", [
  "workspace",
  "agent",
  "credential",
]);

export const spendLimitAction = pgEnum("spend_limit_action", ["warn", "block"]);

// §7 reserves "chain" and "parallel" for later orchestration modes; the MVP
// enum only carries "coordinator" so adding them requires a future migration.
export const agentGroupMode = pgEnum("agent_group_mode", ["coordinator"]);

export const integrationProvider = pgEnum("integration_provider", ["google"]);

export const integrationStatus = pgEnum("integration_status", [
  "connected",
  "needs_reauth",
  "revoked",
]);

export const deliveryChannelKind = pgEnum("delivery_channel_kind", [
  "email",
  "whatsapp",
]);

export const deliveryChannelStatus = pgEnum("delivery_channel_status", [
  "pending",
  "verified",
  "disabled",
]);

export const deliveryTargetOwnerType = pgEnum("delivery_target_owner_type", [
  "agent",
  "group",
  "schedule",
]);

export const deliveryTargetFormat = pgEnum("delivery_target_format", [
  "full",
  "summary",
]);

export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
]);
