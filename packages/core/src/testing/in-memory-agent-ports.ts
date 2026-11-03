import type {
  Agent,
  AgentTemplate,
  AgentVersion,
  StoredAgentVersion,
} from "../domain/agent.ts";
import type { AgentRepo } from "../ports/agent-repo.ts";

/** In-memory agent store honouring the port: versions are append-only. */
export function createInMemoryAgentRepo(
  templates: readonly AgentTemplate[] = [],
): AgentRepo & {
  agents: Agent[];
  versions: AgentVersion[];
} {
  const agents: Agent[] = [];
  const versions: AgentVersion[] = [];
  const find = (workspaceId: string, id: string) =>
    agents.find(
      (agent) =>
        agent.id === id &&
        agent.workspaceId === workspaceId &&
        agent.archivedAt === null,
    );

  return {
    agents,
    versions,

    async insert(workspaceId, agent) {
      agents.push({ ...agent, workspaceId });
      return { ...agent, workspaceId };
    },
    async insertWithFirstVersion(workspaceId, agent, version) {
      const created = { ...agent, workspaceId };
      const createdVersion: AgentVersion = {
        ...version,
        workspaceId,
        createdAt: new Date(1_700_000_000_000 + versions.length * 1000),
      };
      // All or nothing, like the transaction in the Postgres adapter.
      agents.push({ ...created, currentVersionId: createdVersion.id });
      versions.push(createdVersion);
      return {
        agent: { ...created, currentVersionId: createdVersion.id },
        version: createdVersion,
      };
    },

    async findById(workspaceId, id) {
      const agent = find(workspaceId, id);
      return agent ? { ...agent } : null;
    },
    async list(workspaceId) {
      return agents
        .filter(
          (agent) =>
            agent.workspaceId === workspaceId && agent.archivedAt === null,
        )
        .sort((left, right) => right.id.localeCompare(left.id))
        .map((agent) => ({ ...agent }));
    },
    async updateMeta(workspaceId, id, meta) {
      const agent = find(workspaceId, id);
      if (!agent) return null;
      if (meta.name !== undefined) agent.name = meta.name;
      if (meta.description !== undefined) agent.description = meta.description;
      return { ...agent };
    },
    async setCurrentVersion(workspaceId, id, versionId) {
      const agent = find(workspaceId, id);
      if (!agent) return null;
      agent.currentVersionId = versionId;
      return { ...agent };
    },
    async archive(workspaceId, id, archivedAt) {
      const agent = find(workspaceId, id);
      if (!agent) return null;
      agent.archivedAt = archivedAt;
      return { ...agent };
    },

    async insertVersion(workspaceId, version: StoredAgentVersion) {
      const created: AgentVersion = {
        ...version,
        workspaceId,
        createdAt: new Date(1_700_000_000_000 + versions.length * 1000),
      };
      versions.push(created);
      return created;
    },
    async findVersion(workspaceId, agentId, versionId) {
      return (
        versions.find(
          (version) =>
            version.id === versionId &&
            version.agentId === agentId &&
            version.workspaceId === workspaceId,
        ) ?? null
      );
    },
    async listVersions(workspaceId, agentId) {
      return versions
        .filter(
          (version) =>
            version.workspaceId === workspaceId && version.agentId === agentId,
        )
        .sort((left, right) => right.version - left.version);
    },
    async latestVersionNumber(workspaceId, agentId) {
      const own = versions.filter(
        (version) =>
          version.workspaceId === workspaceId && version.agentId === agentId,
      );
      return own.reduce((max, version) => Math.max(max, version.version), 0);
    },
    async listTemplates() {
      return [...templates];
    },
    async findTemplate(templateId) {
      return templates.find((template) => template.id === templateId) ?? null;
    },
    async currentVersion(workspaceId, agentId) {
      const agent = find(workspaceId, agentId);
      if (!agent?.currentVersionId) return null;
      return (
        versions.find(
          (version) =>
            version.id === agent.currentVersionId &&
            version.workspaceId === workspaceId,
        ) ?? null
      );
    },
  };
}
