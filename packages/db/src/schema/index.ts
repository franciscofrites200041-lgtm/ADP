export * from "./agent.js";
export * from "./api-token.js";
export * from "./audit.js";
export * from "./auth.js";
export * from "./conversation.js";
export * from "./credential.js";
export * from "./delivery.js";
export * from "./enums.js";
export * from "./group.js";
export * from "./integration.js";
export * from "./message.js";
export * from "./run.js";
export * from "./usage.js";
export * from "./workspace.js";

import { agent, agentTemplate, agentVersion } from "./agent.js";
import { apiToken } from "./api-token.js";
import { auditLog } from "./audit.js";
import { conversation } from "./conversation.js";
import { providerCredential, toolConnection } from "./credential.js";
import { delivery, deliveryChannel, deliveryTarget } from "./delivery.js";
import { agentGroup, agentGroupMember } from "./group.js";
import { integration } from "./integration.js";
import { message } from "./message.js";
import { approval, run, runEvent, schedule, toolCall } from "./run.js";
import { spendLimit, usageRecord } from "./usage.js";
import { workspaceKey } from "./workspace.js";

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
