"use client";

import {
  type AgentResponse,
  agentListResponseSchema,
  type ConversationResponse,
  conversationResponseSchema,
  type MessageListResponse,
  messageListResponseSchema,
} from "@middleware/contracts";
import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import { requestJson, requestVoid } from "../../../shared/api-client.ts";

/**
 * Chat-route queries (S11). The agent picker reads the same endpoint the
 * Agents screen owns, but chat needs only id and name, so it keeps its own
 * thin query instead of importing another route's module (Scope Rule).
 */
export function useAgentOptions(
  fallback: string,
): UseQueryResult<AgentResponse[], Error> {
  return useQuery({
    queryKey: ["chat-agents"],
    queryFn: () =>
      requestJson(
        "/api/agents",
        { method: "GET" },
        (body) => agentListResponseSchema.parse(body).agents,
        fallback,
      ),
  });
}

/**
 * The conversation history, oldest first (S11). The cursor moves forward in
 * time, so pages arrive in order; the screen keeps fetching until it has
 * caught up with the live tail.
 */
export function useConversationMessages(
  conversationId: string | null,
  fallback: string,
): UseInfiniteQueryResult<InfiniteData<MessageListResponse>, Error> {
  return useInfiniteQuery({
    queryKey: ["conversation", conversationId, "messages"],
    enabled: conversationId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      if (conversationId === null) throw new Error(fallback);
      const id = encodeURIComponent(conversationId);
      const cursor =
        pageParam === undefined
          ? ""
          : `?cursor=${encodeURIComponent(pageParam)}`;
      return requestJson(
        `/api/conversations/${id}/messages${cursor}`,
        { method: "GET" },
        (body) => messageListResponseSchema.parse(body),
        fallback,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** `POST /api/conversations` (S11): the chat needs an id before the first run. */
export async function createConversation(
  agentId: string,
  fallback: string,
): Promise<ConversationResponse> {
  return requestJson(
    "/api/conversations",
    {
      method: "POST",
      body: JSON.stringify({ agentId }),
    },
    (body) => conversationResponseSchema.parse(body),
    fallback,
  );
}

/** `POST /api/runs/:id/cancel` (S11): the run ends cancelled. */
export async function cancelRun(
  runId: string,
  fallback: string,
): Promise<void> {
  return requestVoid(
    `/api/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
    fallback,
  );
}
