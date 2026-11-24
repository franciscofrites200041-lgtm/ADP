/**
 * Tokens and cost of one assistant message (§7). One row per assistant
 * message; the cost comes from pi-ai's `usage.cost`, in USD.
 */
export type UsageRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  createdAt: Date;
};

/** What `UsageRepo.insert` needs; the id and timestamp are server-stamped. */
export type UsageRecordDraft = {
  runId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};
