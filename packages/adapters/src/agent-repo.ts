import {
  agentParamsSchema,
  agentToolsSchema,
  providerIdSchema,
} from "@middleware/contracts";
import type {
  Agent,
  AgentRepo,
  AgentVersion,
  StoredAgent,
  StoredAgentVersion,
} from "@middleware/core";
import { agent as agentTable, agentVersion } from "@middleware/db";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";

type Database = ReturnType<typeof drizzle>;

const agentColumns = {
  id: agentTable.id,
  workspaceId: agentTable.workspaceId,
  name: agentTable.name,
  description: agentTable.description,
  currentVersionId: agentTable.currentVersionId,
  templateId: agentTable.templateId,
  createdBy: agentTable.createdBy,
  archivedAt: agentTable.archivedAt,
};

const active = (workspaceId: string, id: string) =>
  and(
    eq(agentTable.workspaceId, workspaceId),
    eq(agentTable.id, id),
    isNull(agentTable.archivedAt),
  );

const toAgent = (row: typeof agentTable.$inferSelect): Agent => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  description: row.description,
  currentVersionId: row.currentVersionId,
  templateId: row.templateId,
  createdBy: row.createdBy,
  archivedAt: row.archivedAt,
});

/**
 * `params`, `tools` and `provider_id` are untyped at the driver (jsonb, text):
 * they are validated here, at the boundary, instead of cast to a type we hope
 * the row honours.
 */
const toVersion = (row: typeof agentVersion.$inferSelect): AgentVersion => ({
  id: row.id,
  agentId: row.agentId,
  workspaceId: row.workspaceId,
  version: row.version,
  instructions: row.instructions,
  providerId: providerIdSchema.parse(row.providerId),
  modelId: row.modelId,
  credentialId: row.credentialId,
  params: agentParamsSchema.parse(row.params),
  tools: agentToolsSchema.parse(row.tools),
  createdAt: row.createdAt,
});

/**
 * Postgres adapter of `AgentRepo`. Versions are append-only: the only writes are
 * inserts and the agent's `current_version_id` pointer.
 */
export function createAgentRepo(db: Database): AgentRepo {
  return {
    async insert(workspaceId, agent: StoredAgent) {
      const [row] = await db
        .insert(agentTable)
        .values({ ...agent, workspaceId })
        .returning(agentColumns);
      if (!row) throw new Error("agent insert returned no row");
      return toAgent(row);
    },

    async insertWithFirstVersion(workspaceId, agent, version) {
      // One unit: an agent without its first version is not a valid state.
      return db.transaction(async (tx) => {
        const [agentRow] = await tx
          .insert(agentTable)
          .values({ ...agent, workspaceId })
          .returning(agentColumns);
        if (!agentRow) throw new Error("agent insert returned no row");
        const [versionRow] = await tx
          .insert(agentVersion)
          .values({ ...version, workspaceId })
          .returning();
        if (!versionRow)
          throw new Error("agent version insert returned no row");
        const [pointed] = await tx
          .update(agentTable)
          .set({ currentVersionId: versionRow.id })
          .where(active(workspaceId, agentRow.id))
          .returning(agentColumns);
        return {
          agent: toAgent(pointed ?? agentRow),
          version: toVersion(versionRow),
        };
      });
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select(agentColumns)
        .from(agentTable)
        .where(active(workspaceId, id));
      return rows[0] ? toAgent(rows[0]) : null;
    },

    async list(workspaceId) {
      const rows = await db
        .select(agentColumns)
        .from(agentTable)
        .where(
          and(
            eq(agentTable.workspaceId, workspaceId),
            isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(desc(agentTable.id));
      return rows.map(toAgent);
    },

    async updateMeta(workspaceId, id, meta) {
      const rows = await db
        .update(agentTable)
        .set({
          ...(meta.name === undefined ? {} : { name: meta.name }),
          ...(meta.description === undefined
            ? {}
            : { description: meta.description }),
        })
        .where(active(workspaceId, id))
        .returning(agentColumns);
      return rows[0] ? toAgent(rows[0]) : null;
    },

    async setCurrentVersion(workspaceId, id, versionId) {
      const rows = await db
        .update(agentTable)
        .set({ currentVersionId: versionId })
        .where(active(workspaceId, id))
        .returning(agentColumns);
      return rows[0] ? toAgent(rows[0]) : null;
    },

    async archive(workspaceId, id, archivedAt) {
      const rows = await db
        .update(agentTable)
        .set({ archivedAt })
        .where(active(workspaceId, id))
        .returning(agentColumns);
      return rows[0] ? toAgent(rows[0]) : null;
    },

    async insertVersion(workspaceId, version: StoredAgentVersion) {
      const [row] = await db
        .insert(agentVersion)
        .values({ ...version, workspaceId })
        .returning();
      if (!row) throw new Error("agent version insert returned no row");
      return toVersion(row);
    },

    async findVersion(workspaceId, agentId, versionId) {
      const rows = await db
        .select()
        .from(agentVersion)
        .where(
          and(
            eq(agentVersion.workspaceId, workspaceId),
            eq(agentVersion.agentId, agentId),
            eq(agentVersion.id, versionId),
          ),
        );
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async listVersions(workspaceId, agentId) {
      const rows = await db
        .select()
        .from(agentVersion)
        .where(
          and(
            eq(agentVersion.workspaceId, workspaceId),
            eq(agentVersion.agentId, agentId),
          ),
        )
        .orderBy(desc(agentVersion.version));
      return rows.map(toVersion);
    },

    async latestVersionNumber(workspaceId, agentId) {
      const rows = await db
        .select({ latest: max(agentVersion.version) })
        .from(agentVersion)
        .where(
          and(
            eq(agentVersion.workspaceId, workspaceId),
            eq(agentVersion.agentId, agentId),
          ),
        );
      return rows[0]?.latest ?? 0;
    },

    async currentVersion(workspaceId, agentId) {
      const rows = await db
        .select()
        .from(agentVersion)
        .where(
          and(
            eq(agentVersion.workspaceId, workspaceId),
            eq(agentVersion.agentId, agentId),
          ),
        )
        .orderBy(desc(agentVersion.version))
        .limit(1);
      return rows[0] ? toVersion(rows[0]) : null;
    },
  };
}
