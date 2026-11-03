"use client";

import {
  type AgentResponse,
  type AgentTemplate,
  type AgentVersionResponse,
  agentIdParamSchema,
  agentListResponseSchema,
  agentResponseSchema,
  agentTemplateListResponseSchema,
  agentVersionListResponseSchema,
  type CreateAgentRequest,
  createAgentRequestSchema,
  duplicateAgentRequestSchema,
  type ModelDescriptor,
  modelListResponseSchema,
  restoreAgentVersionRequestSchema,
  type UpdateAgentRequest,
  updateAgentRequestSchema,
} from "@middleware/contracts";
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";

import {
  localInputError,
  requestJson,
  requestVoid,
} from "../../../shared/api-client.ts";
import { useCredentials } from "../../../shared/credentials.ts";

const LIST_KEY = ["agents"] as const;

/** Every id comes from the contract, never hand-typed. */
type AgentId = z.infer<typeof agentResponseSchema.shape.id>;

export type UpdateAgentInput = UpdateAgentRequest & { id: AgentId };
export type RestoreInput = { id: AgentId; versionId: AgentId };
export type DuplicateInput = { id: AgentId; name: string };
export type ArchiveInput = { id: AgentId };

export function useAgents(
  fallback: string,
): UseQueryResult<AgentResponse[], Error> {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () =>
      requestJson(
        "/api/agents",
        { method: "GET" },
        (body) => agentListResponseSchema.parse(body).agents,
        fallback,
      ),
  });
}

/** The global template catalogue: choosing one prefills the form (WP-21). */
export function useAgentTemplates(
  fallback: string,
): UseQueryResult<AgentTemplate[], Error> {
  return useQuery({
    queryKey: ["agent-templates"],
    queryFn: () =>
      requestJson(
        "/api/agent-templates",
        { method: "GET" },
        (body) => agentTemplateListResponseSchema.parse(body).templates,
        fallback,
      ),
  });
}

export function useAgentVersions(
  agentId: string | null,
  fallback: string,
): UseQueryResult<AgentVersionResponse[], Error> {
  return useQuery({
    queryKey: [...LIST_KEY, agentId, "versions"],
    enabled: agentId !== null,
    queryFn: () =>
      requestJson(
        `/api/agents/${encodeURIComponent(agentId ?? "")}/versions`,
        { method: "GET" },
        (body) => agentVersionListResponseSchema.parse(body).versions,
        fallback,
      ),
  });
}

export { useCredentials as useCredentialPicker };

/** Models of the chosen credential: the API caches them for an hour (WP-13). */
export function useCredentialModels(
  credentialId: string,
  fallback: string,
): UseQueryResult<ModelDescriptor[], Error> {
  return useQuery({
    queryKey: ["credentials", credentialId, "models"],
    enabled: credentialId !== "",
    queryFn: () =>
      requestJson(
        `/api/credentials/${encodeURIComponent(credentialId)}/models`,
        { method: "GET" },
        (body) => modelListResponseSchema.parse(body).models,
        fallback,
      ),
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: LIST_KEY });
}

export function useCreateAgent(
  fallback: string,
): UseMutationResult<AgentResponse, Error, CreateAgentRequest> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input) => {
      const parsed = createAgentRequestSchema.safeParse(input);
      if (!parsed.success) throw localInputError(fallback);
      return requestJson(
        "/api/agents",
        { method: "POST", body: JSON.stringify(parsed.data) },
        (body) => agentResponseSchema.parse(body),
        fallback,
      );
    },
    onSuccess: refresh,
  });
}

export function useUpdateAgent(
  fallback: string,
): UseMutationResult<AgentResponse, Error, UpdateAgentInput> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...input }) => {
      const parsed = updateAgentRequestSchema.safeParse(input);
      if (!parsed.success) throw localInputError(fallback);
      return requestJson(
        `/api/agents/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(parsed.data) },
        (body) => agentResponseSchema.parse(body),
        fallback,
      );
    },
    onSuccess: refresh,
  });
}

export function useRestoreAgentVersion(
  fallback: string,
): UseMutationResult<AgentResponse, Error, RestoreInput> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, versionId }) => {
      const parsed = restoreAgentVersionRequestSchema.safeParse({ versionId });
      const path = agentIdParamSchema.safeParse({ id });
      if (!parsed.success || !path.success) throw localInputError(fallback);
      return requestJson(
        `/api/agents/${encodeURIComponent(id)}/restore`,
        { method: "POST", body: JSON.stringify(parsed.data) },
        (body) => agentResponseSchema.parse(body),
        fallback,
      );
    },
    onSuccess: refresh,
  });
}

export function useDuplicateAgent(
  fallback: string,
): UseMutationResult<AgentResponse, Error, DuplicateInput> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, name }) => {
      const parsed = duplicateAgentRequestSchema.safeParse({ name });
      const path = agentIdParamSchema.safeParse({ id });
      if (!parsed.success || !path.success) throw localInputError(fallback);
      return requestJson(
        `/api/agents/${encodeURIComponent(id)}/duplicate`,
        { method: "POST", body: JSON.stringify(parsed.data) },
        (body) => agentResponseSchema.parse(body),
        fallback,
      );
    },
    onSuccess: refresh,
  });
}

export function useArchiveAgent(
  fallback: string,
): UseMutationResult<void, Error, ArchiveInput> {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id }) => {
      const path = agentIdParamSchema.safeParse({ id });
      if (!path.success) throw localInputError(fallback);
      return requestVoid(
        `/api/agents/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        fallback,
      );
    },
    onSuccess: refresh,
  });
}
