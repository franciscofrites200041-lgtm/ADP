import type { RunEvent } from "@middleware/contracts";
import { runEventSchema } from "@middleware/contracts";
import type { RunEventStore, StoredRunEvent } from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, asc, eq, gt, max, sql } from "drizzle-orm";

const runEventTable = schema.runEvent;

const DEFAULT_LIST_LIMIT = 100;

const toStored = (row: {
  seq: number;
  payload: unknown;
  createdAt: Date;
}): StoredRunEvent => ({
  seq: row.seq,
  // jsonb at the driver: validated at the boundary, never cast and hoped for.
  event: runEventSchema.parse(row.payload),
  createdAt: row.createdAt,
});

/**
 * Postgres adapter of `RunEventStore` over the `run_event` table. `append` is
 * concurrency-safe: inside one transaction it takes
 * `pg_advisory_xact_lock(hashtext(runId))`, reads `coalesce(max(seq), 0)` and
 * inserts the batch with consecutive seqs, so two concurrent appenders for
 * the same run serialize instead of colliding. The `unique(run_id, seq)`
 * constraint stays as the backstop, not the mechanism.
 */
export function createRunEventStore(db: DbClient): RunEventStore {
  return {
    async append(workspaceId, runId, events: readonly RunEvent[]) {
      if (events.length === 0) return [];
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${runId}))`);
        const [row] = await tx
          .select({ maxSeq: max(runEventTable.seq) })
          .from(runEventTable)
          .where(eq(runEventTable.runId, runId));
        let seq = row?.maxSeq ?? 0;
        const values = events.map((event) => {
          seq += 1;
          return { runId, workspaceId, seq, type: event.type, payload: event };
        });
        const inserted = await tx
          .insert(runEventTable)
          .values(values)
          .returning({
            seq: runEventTable.seq,
            payload: runEventTable.payload,
            createdAt: runEventTable.createdAt,
          });
        return inserted.map(toStored);
      });
    },

    async listAfter(workspaceId, runId, afterSeq, limit = DEFAULT_LIST_LIMIT) {
      const rows = await db
        .select({
          seq: runEventTable.seq,
          payload: runEventTable.payload,
          createdAt: runEventTable.createdAt,
        })
        .from(runEventTable)
        .where(
          and(
            eq(runEventTable.workspaceId, workspaceId),
            eq(runEventTable.runId, runId),
            gt(runEventTable.seq, afterSeq),
          ),
        )
        .orderBy(asc(runEventTable.seq))
        .limit(limit);
      return rows.map(toStored);
    },
  };
}
