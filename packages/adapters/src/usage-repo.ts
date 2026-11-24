import type {
  UsageRecord,
  UsageRecordDraft,
  UsageRepo,
} from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const usageTable = schema.usageRecord;

/**
 * Write inputs are validated here, at the boundary (AGENTS.md): token
 * counts are non-negative integers and the cost is a finite, non-negative
 * number (the column's check constraints only see what reaches them).
 */
const usageDraftSchema = z.strictObject({
  runId: z.uuid(),
  agentId: z.uuid(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  costUsd: z.number().finite().nonnegative(),
});

/**
 * `cost_usd` is numeric at the driver: drizzle reads it as a string and the
 * domain wants the number the caller stored, exact to the column's six
 * decimals (§7).
 */
const toUsageRecord = (row: typeof usageTable.$inferSelect): UsageRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  runId: row.runId,
  agentId: row.agentId,
  providerId: row.providerId,
  modelId: row.modelId,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  cacheReadTokens: row.cacheReadTokens,
  cacheWriteTokens: row.cacheWriteTokens,
  costUsd: Number(row.costUsd),
  createdAt: row.createdAt,
});

/** Postgres adapter of `UsageRepo` over the `usage_record` table (§7). */
export function createUsageRepo(db: DbClient): UsageRepo {
  return {
    async insert(workspaceId, record: UsageRecordDraft) {
      const draft = usageDraftSchema.parse(record);
      // The FKs only prove the rows exist, not that they are ours (S4):
      // both the run and the agent must belong to the workspace, or the
      // usage record reads as missing instead of pointing across tenants.
      const [run] = await db
        .select({ id: schema.run.id })
        .from(schema.run)
        .where(
          and(
            eq(schema.run.workspaceId, workspaceId),
            eq(schema.run.id, draft.runId),
          ),
        );
      const [agent] = await db
        .select({ id: schema.agent.id })
        .from(schema.agent)
        .where(
          and(
            eq(schema.agent.workspaceId, workspaceId),
            eq(schema.agent.id, draft.agentId),
          ),
        );
      if (!run || !agent) throw new NotFoundError();
      const [row] = await db
        .insert(usageTable)
        .values({
          workspaceId,
          runId: draft.runId,
          agentId: draft.agentId,
          providerId: draft.providerId,
          modelId: draft.modelId,
          inputTokens: draft.inputTokens,
          outputTokens: draft.outputTokens,
          cacheReadTokens: draft.cacheReadTokens,
          cacheWriteTokens: draft.cacheWriteTokens,
          costUsd: draft.costUsd.toString(),
        })
        .returning();
      if (!row) throw new Error("usage record insert returned no row");
      return toUsageRecord(row);
    },
  };
}
