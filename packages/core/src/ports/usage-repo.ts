import type { UsageRecord, UsageRecordDraft } from "../domain/usage.ts";

/**
 * Scopes by `workspaceId` first (S4): the workspace comes from the session,
 * never from the request. Aggregation (WP-60) does not live here: this port
 * only stores one row per assistant message (§7).
 */
export type UsageRepo = {
  /** Inserts one usage record; the id and timestamp are server-stamped. */
  insert(workspaceId: string, record: UsageRecordDraft): Promise<UsageRecord>;
};
