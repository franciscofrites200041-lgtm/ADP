import type {
  Agent,
  AgentVersion,
  StoredAgent,
  StoredAgentVersion,
} from "../domain/agent.ts";

/**
 * Every method scopes by `workspaceId` (S4), so another workspace's agent reads
 * as missing. Versions are append-only: there is no update or delete.
 */
export type AgentRepo = {
  insert(workspaceId: string, agent: StoredAgent): Promise<Agent>;
  /**
   * Agent plus its first version in one unit: an agent without a version is not
   * a valid state, so it must not be observable (S4).
   */
  insertWithFirstVersion(
    workspaceId: string,
    agent: StoredAgent,
    version: StoredAgentVersion,
  ): Promise<{ agent: Agent; version: AgentVersion }>;
  findById(workspaceId: string, id: string): Promise<Agent | null>;
  /** Newest first (ids are UUIDv7). */
  list(workspaceId: string): Promise<Agent[]>;
  updateMeta(
    workspaceId: string,
    id: string,
    meta: { name?: string; description?: string | null },
  ): Promise<Agent | null>;
  setCurrentVersion(
    workspaceId: string,
    id: string,
    versionId: string,
  ): Promise<Agent | null>;
  archive(
    workspaceId: string,
    id: string,
    archivedAt: Date,
  ): Promise<Agent | null>;

  insertVersion(
    workspaceId: string,
    version: StoredAgentVersion,
  ): Promise<AgentVersion>;
  findVersion(
    workspaceId: string,
    agentId: string,
    versionId: string,
  ): Promise<AgentVersion | null>;
  listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[]>;
  /** Highest version number, 0 when the agent has none yet. */
  latestVersionNumber(workspaceId: string, agentId: string): Promise<number>;
  currentVersion(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentVersion | null>;
};
