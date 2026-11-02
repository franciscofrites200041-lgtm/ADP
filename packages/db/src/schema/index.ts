export * from "./agent.ts";
export * from "./api-token.ts";
export * from "./audit.ts";
export * from "./auth.ts";
export * from "./conversation.ts";
export * from "./credential.ts";
export * from "./delivery.ts";
export * from "./enums.ts";
export * from "./group.ts";
export * from "./integration.ts";
export * from "./message.ts";
export * from "./run.ts";
export * from "./usage.ts";
export * from "./workspace.ts";

import { agent, agentTemplate, agentVersion } from "./agent.ts";
import { apiToken } from "./api-token.ts";
import { auditLog } from "./audit.ts";
import { conversation } from "./conversation.ts";
import { providerCredential, toolConnection } from "./credential.ts";
import { delivery, deliveryChannel, deliveryTarget } from "./delivery.ts";
import { agentGroup, agentGroupMember } from "./group.ts";
import { integration } from "./integration.ts";
import { message } from "./message.ts";
import { approval, run, runEvent, schedule, toolCall } from "./run.ts";
import { spendLimit, usageRecord } from "./usage.ts";
import { workspaceKey } from "./workspace.ts";

/**
 * Every product-owned table from MIDDLEWARE_MASTER.md §7, keyed by camelCase
 * name. Better Auth tables (user, session, organization, …) are owned by
 * WP-03 and intentionally absent here.
 */
export const productTables = {
  workspaceKey,
  providerCredential,
  agent,
  agentVersion,
  toolConnection,
  conversation,
  message,
  run,
  runEvent,
  toolCall,
  approval,
  schedule,
  apiToken,
  usageRecord,
  spendLimit,
  agentTemplate,
  auditLog,
  agentGroup,
  agentGroupMember,
  integration,
  deliveryChannel,
  deliveryTarget,
  delivery,
} as const;

export type ProductTable = (typeof productTables)[keyof typeof productTables];
export type ProductTableName = keyof typeof productTables;
