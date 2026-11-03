import type {
  AgentResponse,
  AgentTemplate,
  AgentVersionInput,
  AgentVersionResponse,
  CreateAgentRequest,
  DuplicateAgentRequest,
  UpdateAgentRequest,
} from "@middleware/contracts";

import type { Agent, AgentVersion } from "../domain/agent.ts";
import { NotFoundError } from "../domain/errors.ts";
import type { AgentRepo } from "../ports/agent-repo.ts";
import type { AuditLog } from "../ports/audit-log.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialRepo } from "../ports/credential-repo.ts";
import type { IdGen } from "../ports/id-gen.ts";

const AGENTS = "agent";
const VERSIONS = "agent_version";

export type AgentServiceDeps = {
  agentRepo: AgentRepo;
  credentialRepo: CredentialRepo;
  auditLog: AuditLog;
  clock: Clock;
  idGen: IdGen;
};

/** `workspaceId` and `actorUserId` come from the session, never the request (S4). */
export type AgentService = {
  createAgent(
    workspaceId: string,
    actorUserId: string,
    input: CreateAgentRequest,
  ): Promise<AgentResponse>;
  listAgents(workspaceId: string): Promise<AgentResponse[]>;
  getAgent(workspaceId: string, agentId: string): Promise<AgentResponse>;
  updateAgent(
    workspaceId: string,
    actorUserId: string,
    agentId: string,
    input: UpdateAgentRequest,
  ): Promise<AgentResponse>;
  restoreVersion(
    workspaceId: string,
    actorUserId: string,
    agentId: string,
    versionId: string,
  ): Promise<AgentResponse>;
  duplicateAgent(
    workspaceId: string,
    actorUserId: string,
    agentId: string,
    input: DuplicateAgentRequest,
  ): Promise<AgentResponse>;
  archiveAgent(
    workspaceId: string,
    actorUserId: string,
    agentId: string,
  ): Promise<void>;
  listVersions(
    workspaceId: string,
    agentId: string,
  ): Promise<AgentVersionResponse[]>;
  /** The global template catalogue (WP-21). */
  listTemplates(): Promise<AgentTemplate[]>;
};

const toVersionResponse = (version: AgentVersion): AgentVersionResponse => ({
  id: version.id,
  version: version.version,
  instructions: version.instructions,
  providerId: version.providerId,
  modelId: version.modelId,
  credentialId: version.credentialId,
  params: version.params,
  tools: version.tools,
  createdAt: version.createdAt.toISOString(),
});

export function createAgentService({
  agentRepo,
  credentialRepo,
  auditLog,
  clock,
  idGen,
}: AgentServiceDeps): AgentService {
  const toResponse = async (
    workspaceId: string,
    agent: Agent,
  ): Promise<AgentResponse> => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    currentVersion: await currentVersionResponse(workspaceId, agent),
    archivedAt: agent.archivedAt?.toISOString() ?? null,
  });

  const currentVersionResponse = async (
    workspaceId: string,
    agent: Agent,
  ): Promise<AgentVersionResponse | null> => {
    const version = await agentRepo.currentVersion(workspaceId, agent.id);
    return version === null ? null : toVersionResponse(version);
  };

  const audit = (
    workspaceId: string,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, string> = {},
  ) =>
    auditLog.record(workspaceId, {
      actorUserId,
      action,
      targetType,
      targetId,
      metadata,
    });

  /** A credential of another workspace must read as missing, not as forbidden (S4). */
  const assertCredential = async (
    workspaceId: string,
    credentialId: string,
  ) => {
    const credential = await credentialRepo.findById(workspaceId, credentialId);
    if (!credential) throw new NotFoundError("credential_not_found");
  };

  const appendVersion = async (
    workspaceId: string,
    agentId: string,
    content: AgentVersionInput,
  ): Promise<AgentVersion> => {
    await assertCredential(workspaceId, content.credentialId);
    const version = await agentRepo.insertVersion(workspaceId, {
      id: idGen.newId(),
      agentId,
      workspaceId,
      version: (await agentRepo.latestVersionNumber(workspaceId, agentId)) + 1,
      instructions: content.instructions,
      providerId: content.providerId,
      modelId: content.modelId,
      credentialId: content.credentialId,
      params: content.params,
      tools: content.tools,
    });
    await agentRepo.setCurrentVersion(workspaceId, agentId, version.id);
    return version;
  };

  const requireAgent = async (
    workspaceId: string,
    agentId: string,
  ): Promise<Agent> => {
    const agent = await agentRepo.findById(workspaceId, agentId);
    if (!agent) throw new NotFoundError();
    return agent;
  };

  return {
    async createAgent(workspaceId, actorUserId, input) {
      // Authorise before writing anything: a rejected credential must not leave
      // an agent behind (found by the cross-tenant integration test).
      await assertCredential(workspaceId, input.version.credentialId);
      if (input.templateId !== undefined) {
        const template = await agentRepo.findTemplate(input.templateId);
        if (!template) throw new NotFoundError("template_not_found");
      }
      // Agent and first version land together: there is no moment where an agent
      // exists without a version.
      const createdId = idGen.newId();
      const { agent: created, version } =
        await agentRepo.insertWithFirstVersion(
          workspaceId,
          {
            id: createdId,
            workspaceId,
            name: input.name,
            description: input.description ?? null,
            currentVersionId: null,
            templateId: input.templateId ?? null,
            createdBy: actorUserId,
            archivedAt: null,
          },
          {
            id: idGen.newId(),
            agentId: createdId,
            workspaceId,
            version: 1,
            instructions: input.version.instructions,
            providerId: input.version.providerId,
            modelId: input.version.modelId,
            credentialId: input.version.credentialId,
            params: input.version.params,
            tools: input.version.tools,
          },
        );
      await audit(
        workspaceId,
        actorUserId,
        "agent.created",
        AGENTS,
        created.id,
        {
          version: String(version.version),
        },
      );
      return toResponse(workspaceId, created);
    },

    async listAgents(workspaceId) {
      const agents = await agentRepo.list(workspaceId);
      return Promise.all(agents.map((agent) => toResponse(workspaceId, agent)));
    },

    async getAgent(workspaceId, agentId) {
      return toResponse(workspaceId, await requireAgent(workspaceId, agentId));
    },

    async updateAgent(workspaceId, actorUserId, agentId, input) {
      const agent = await requireAgent(workspaceId, agentId);
      // The credential is checked before the rename, so a foreign one writes
      // nothing. A failure *after* the rename (inserting the version) leaves the
      // new name in place: the rename is its own write, not part of the version.
      if (input.version !== undefined) {
        await assertCredential(workspaceId, input.version.credentialId);
      }

      const hasMeta =
        input.name !== undefined || input.description !== undefined;
      const updated = hasMeta
        ? await agentRepo.updateMeta(workspaceId, agentId, {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined
              ? {}
              : { description: input.description }),
          })
        : agent;
      if (!updated) throw new NotFoundError();

      if (input.version !== undefined) {
        // Editing is never in place: it appends, so history stays truthful (S4).
        const version = await appendVersion(
          workspaceId,
          agentId,
          input.version,
        );
        await audit(
          workspaceId,
          actorUserId,
          "agent.version_created",
          VERSIONS,
          version.id,
          { agentId, version: String(version.version) },
        );
      }

      return toResponse(workspaceId, updated);
    },

    async restoreVersion(workspaceId, actorUserId, agentId, versionId) {
      await requireAgent(workspaceId, agentId);
      const source = await agentRepo.findVersion(
        workspaceId,
        agentId,
        versionId,
      );
      if (!source || source.credentialId === null) {
        throw new NotFoundError("version_not_found");
      }

      // Restoring is appending a copy: the chosen version is never rewritten.
      const restored = await appendVersion(workspaceId, agentId, {
        instructions: source.instructions,
        providerId: source.providerId,
        modelId: source.modelId,
        credentialId: source.credentialId,
        params: source.params,
        tools: source.tools,
      });
      await audit(
        workspaceId,
        actorUserId,
        "agent.version_restored",
        VERSIONS,
        restored.id,
        { agentId, fromVersion: String(source.version) },
      );
      return toResponse(workspaceId, await requireAgent(workspaceId, agentId));
    },

    async duplicateAgent(workspaceId, actorUserId, agentId, input) {
      const source = await requireAgent(workspaceId, agentId);
      const current = await agentRepo.currentVersion(workspaceId, agentId);
      if (!current || current.credentialId === null) {
        throw new NotFoundError("version_not_found");
      }

      // Same rules as creation: the credential is checked first, and the copy
      // lands as one unit so a versionless agent is never observable.
      await assertCredential(workspaceId, current.credentialId);
      const copyId = idGen.newId();
      const { agent: copy } = await agentRepo.insertWithFirstVersion(
        workspaceId,
        {
          id: copyId,
          workspaceId,
          name: input.name,
          description: source.description,
          currentVersionId: null,
          templateId: source.templateId,
          createdBy: actorUserId,
          archivedAt: null,
        },
        {
          id: idGen.newId(),
          agentId: copyId,
          workspaceId,
          version: 1,
          instructions: current.instructions,
          providerId: current.providerId,
          modelId: current.modelId,
          credentialId: current.credentialId,
          params: current.params,
          tools: current.tools,
        },
      );
      await audit(
        workspaceId,
        actorUserId,
        "agent.duplicated",
        AGENTS,
        copy.id,
        { fromAgentId: agentId },
      );
      return toResponse(workspaceId, copy);
    },

    async archiveAgent(workspaceId, actorUserId, agentId) {
      const archived = await agentRepo.archive(
        workspaceId,
        agentId,
        clock.now(),
      );
      if (!archived) throw new NotFoundError();
      await audit(workspaceId, actorUserId, "agent.archived", AGENTS, agentId);
    },

    async listTemplates() {
      return agentRepo.listTemplates();
    },

    async listVersions(workspaceId, agentId) {
      await requireAgent(workspaceId, agentId);
      const versions = await agentRepo.listVersions(workspaceId, agentId);
      return versions.map(toVersionResponse);
    },
  };
}
