import { runCheckpointSchema, runStatusSchema } from "@middleware/contracts";
import type {
  Run,
  RunDraft,
  RunListFilter,
  RunOutcome,
  RunProgress,
  RunRepo,
  RunSweeper,
  SweptRun,
} from "@middleware/core";
import { type DbClient, schema } from "@middleware/db";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { InvariantError } from "./errors.ts";

const runTable = schema.run;

/** Lease methods only touch runs a process could still resume (§5). */
const resumable = inArray(runTable.status, [
  "queued",
  "running",
  "waiting_approval",
]);

/**
 * `input`, `output` and `checkpoint` are jsonb at the driver but typed in the
 * domain: validated here, at the boundary, instead of cast to a type we hope
 * the row honours (same rule as the agent repo's jsonb columns). The
 * checkpoint shape lives once in `@middleware/contracts`: it is what the
 * engine writes and what a resume (WP-50) reads.
 */
const runPayloadSchema = z.strictObject({
  input: z.string(),
  output: z.string().nullable(),
  checkpoint: runCheckpointSchema.nullable(),
});

const toRun = (row: typeof runTable.$inferSelect): Run => {
  const payload = runPayloadSchema.safeParse({
    input: row.input,
    output: row.output,
    checkpoint: row.checkpoint,
  });
  if (!payload.success) {
    // A malformed row is a broken invariant, never a silent `undefined`;
    // the message names the offending columns, not their content.
    throw new InvariantError(
      "run_row_malformed",
      `run row ${row.id} does not honour the contract (fields: ${payload.error.issues
        .map((issue) => String(issue.path[0]))
        .join(", ")})`,
    );
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentVersionId: row.agentVersionId,
    conversationId: row.conversationId,
    status: runStatusSchema.parse(row.status),
    ...payload.data,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    turnsCompleted: row.turnsCompleted,
    leaseUntil: row.leaseUntil,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
};

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
      // Safe: an INSERT … RETURNING without ON CONFLICT yields exactly one
      // row; anything else is a broken invariant, not a user outcome.
      if (!row) {
        throw new InvariantError(
          "run_insert_no_row",
          "run insert returned no row",
        );
      }
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
  };
}

/**
 * Postgres adapter of the `RunSweeper` port (ADR-0007), over the same pool as
 * `createRunRepo`. The sweep is a system job with no session, so it selects
 * only the identifier columns: the query itself is what keeps run content out
 * of the result.
 */
export function createRunSweeper(db: DbClient): RunSweeper {
  return {
    async listExpiredLeases(now): Promise<SweptRun[]> {
      const rows = await db
        .select({ workspaceId: runTable.workspaceId, id: runTable.id })
        .from(runTable)
        .where(
          and(eq(runTable.status, "running"), lt(runTable.leaseUntil, now)),
        )
        .orderBy(runTable.leaseUntil);
      return rows.map((row) => ({
        workspaceId: row.workspaceId,
        runId: row.id,
      }));
    },
  };
}
