import type {
  AgentParams,
  AgentTemplate,
  ProviderId,
} from "@middleware/contracts";

// Re-exported so adapters can type the jsonb column without importing contracts
// directly. The domain keeps `Date` where the contract carries an ISO string:
// they are different shapes on purpose, not duplicates.
export type { AgentParams, AgentTemplate };

/** An agent's mutable identity; its content lives in immutable versions. */
export type Agent = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  templateId: string | null;
  createdBy: string | null;
  archivedAt: Date | null;
};

/** One immutable snapshot. Editing writes a new row, never an update (S4). */
export type AgentVersion = {
  id: string;
  agentId: string;
  workspaceId: string;
  version: number;
  instructions: string;
  providerId: ProviderId;
  modelId: string;
  /** Nullable in `agent_version`: a version whose credential is gone (§8). */
  credentialId: string | null;
  params: AgentParams;
  tools: string[];
  createdAt: Date;
};

export type StoredAgent = Agent;

export type StoredAgentVersion = Omit<AgentVersion, "createdAt">;
