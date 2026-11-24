import { runStatusSchema } from "@middleware/contracts";
import type {
  Run,
  RunDraft,
  RunListFilter,
  RunOutcome,
  RunProgress,
  RunRepo,
} from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

const runTable = schema.run;

/** Lease methods only touch runs a process could still resume (§5). */
const resumable = inArray(runTable.status, [
  "queued",
  "running",
  "waiting_approval",
]);

/**
 * `input` and `output` are jsonb at the driver but strings in the domain:
 * validated here, at the boundary, instead of cast to a type we hope the
 * row honours (same rule as the agent repo's jsonb columns).
 */
const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`run ${field} is not text`);
  return value;
};

const asNullableText = (value: unknown, field: string): string | null =>
  value === null ? null : asText(value, field);

const toRun = (row: typeof runTable.$inferSelect): Run => ({
  id: row.id,
  workspaceId: row.workspaceId,
  agentId: row.agentId,
  agentVersionId: row.agentVersionId,
  conversationId: row.conversationId,
  status: runStatusSchema.parse(row.status),
  input: asText(row.input, "input"),
  output: asNullableText(row.output, "output"),
  errorCode: row.errorCode,
  errorMessage: row.errorMessage,
  turnsCompleted: row.turnsCompleted,
  checkpoint: row.checkpoint,
  leaseUntil: row.leaseUntil,
  queuedAt: row.queuedAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

/** Postgres adapter of `RunRepo` over the `run` table. */
export function createRunRepo(db: DbClient): RunRepo {
  return {
    async insert(workspaceId, draft: RunDraft) {
      const [row] = await db
        .insert(runTable)
        .values({
          id: draft.id,
          workspaceId,
          agentId: draft.agentId,
          agentVersionId: draft.agentVersionId,
          conversationId: draft.conversationId,
          trigger: draft.trigger,
          // A root run points at itself; delegation children (WP-55) will
          // point at their parent once the engine creates them.
          rootRunId: draft.id,
          input: draft.input,
          status: "queued",
        })
        .returning();
      if (!row) throw new Error("run insert returned no row");
      return toRun(row);
    },

    async findById(workspaceId, runId) {
      const [row] = await db
        .select()
        .from(runTable)
        .where(
          and(eq(runTable.workspaceId, workspaceId), eq(runTable.id, runId)),
        );
      return row ? toRun(row) : null;
    },

    async claimLease(workspaceId, runId, leaseUntil) {
      const [row] = await db
        .update(runTable)
        .set({
          status: "running",
          leaseUntil,
          startedAt: sql`coalesce(${runTable.startedAt}, now())`,
        })
        // The lease predicate is the whole contract: absent or already
        // expired wins, a live lease loses (checked inside the UPDATE, so
        // two claimers race on one row lock and exactly one gets a row).
        .where(
          and(
            eq(runTable.workspaceId, workspaceId),
            eq(runTable.id, runId),
            resumable,
            or(
              sql`${runTable.leaseUntil} is null`,
              sql`${runTable.leaseUntil} <= now()`,
            ),
          ),
        )
        .returning({ id: runTable.id });
      return row !== undefined;
    },

    async renewLease(workspaceId, runId, leaseUntil) {
      const [row] = await db
        .update(runTable)
        .set({ leaseUntil })
        .where(
          and(
            eq(runTable.workspaceId, workspaceId),
            eq(runTable.id, runId),
            resumable,
          ),
        )
        .returning();
      return row ? toRun(row) : null;
    },

    async saveProgress(workspaceId, runId, progress: RunProgress) {
      const [row] = await db
        .update(runTable)
        .set({
          checkpoint: progress.checkpoint,
          turnsCompleted: progress.turnsCompleted,
        })
        .where(
          and(
            eq(runTable.workspaceId, workspaceId),
            eq(runTable.id, runId),
            resumable,
          ),
        )
        .returning();
      return row ? toRun(row) : null;
    },

    async finish(workspaceId, runId, outcome: RunOutcome) {
      const [row] = await db
        .update(runTable)
        .set({
          status: outcome.status,
          output: "output" in outcome ? outcome.output : null,
          errorCode: "errorCode" in outcome ? outcome.errorCode : null,
          errorMessage: "errorMessage" in outcome ? outcome.errorMessage : null,
          finishedAt: new Date(),
          // Terminal: the lease dies with the run.
          leaseUntil: null,
        })
        .where(
          and(eq(runTable.workspaceId, workspaceId), eq(runTable.id, runId)),
        )
        .returning();
      return row ? toRun(row) : null;
    },

    async listByWorkspace(workspaceId, filter: RunListFilter) {
      const conditions = [eq(runTable.workspaceId, workspaceId)];
      if (filter.status) conditions.push(eq(runTable.status, filter.status));
      const rows = await db
        .select()
        .from(runTable)
        .where(and(...conditions))
        .orderBy(desc(runTable.queuedAt), desc(runTable.id))
        .limit(filter.limit ?? 100);
      return rows.map(toRun);
    },

    // No workspace filter on purpose: a system sweep, see the port doc.
    async listExpiredLeases(now) {
      const rows = await db
        .select()
        .from(runTable)
        .where(
          and(eq(runTable.status, "running"), lt(runTable.leaseUntil, now)),
        )
        .orderBy(runTable.leaseUntil);
      return rows.map(toRun);
    },
  };
}
