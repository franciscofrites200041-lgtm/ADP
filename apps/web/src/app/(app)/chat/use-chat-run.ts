"use client";

import type { MessageResponse, RunEvent } from "@middleware/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { userMessage } from "../../../shared/api-client.ts";
import {
  appendLive,
  type LiveMessage,
  replaceLiveText,
} from "./chat-transcript.tsx";
import {
  cancelRun,
  createConversation,
  useConversationMessages,
} from "./queries.ts";
import { openRunStream, type RunStreamEnd } from "./run-stream.ts";

type LiveRun = {
  runId: string | null;
  phase: "connecting" | "streaming" | "failed" | "cancelled";
  error: string | null;
};

type UseChatRunOptions = {
  /** Validated `?agent=` from the URL, or null. */
  initialAgent: string | null;
  /** Validated `?conversation=` from the URL, or null. */
  initialConversation: string | null;
  /** Validated `?run=` from the URL: the run to rehydrate (S6). */
  initialRun: string | null;
  sendError: string;
  cancelError: string;
};

/** Keeps the address bookable: a reload can rehydrate the same conversation. */
export function replaceUrl(
  agent: string | null,
  conversation: string | null,
  run: string | null,
): void {
  const params = new URLSearchParams();
  if (agent !== null) params.set("agent", agent);
  if (conversation !== null) params.set("conversation", conversation);
  if (run !== null) params.set("run", run);
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query === "" ? "" : `?${query}`}`,
  );
}

/**
 * The run side of the chat screen: which conversation is open, the message
 * being sent, the live answer rebuilt from run events (S8), and the run in
 * the URL so a reload rehydrates without losing text (S6).
 */
export function useChatRun({
  initialAgent,
  initialConversation,
  initialRun,
  sendError,
  cancelError,
}: UseChatRunOptions) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversation,
  );
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([]);

  const lastSeqRef = useRef(0);
  const streamRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(initialConversation);
  // The address keeps the agent too: a reload rehydrates the screen from the
  // URL, and without the agent there is no transcript to rebuild into (S6).
  const agentIdRef = useRef<string | null>(initialAgent);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const applyEvent = useCallback(
    (event: RunEvent, seq: number) => {
      if (seq > lastSeqRef.current) lastSeqRef.current = seq;
      switch (event.type) {
        case "run.started": {
          setLive((prev) =>
            prev === null
              ? prev
              : { ...prev, runId: event.runId, phase: "streaming" },
          );
          // Bookmarked for the reload: a refresh rehydrates this same run.
          replaceUrl(
            agentIdRef.current,
            conversationIdRef.current,
            event.runId,
          );
          // The run row and its user message already exist (S1).
          void queryClient.invalidateQueries({ queryKey: ["conversation"] });
          break;
        }
        case "message.delta": {
          setLiveMessages((prev) =>
            appendLive(prev, event.messageId, event.text),
          );
          break;
        }
        case "message.completed": {
          setLiveMessages((prev) =>
            replaceLiveText(prev, event.messageId, event.content),
          );
          break;
        }
        case "run.failed": {
          setLive((prev) =>
            prev === null
              ? prev
              : { ...prev, phase: "failed", error: event.message },
          );
          break;
        }
        case "run.cancelled": {
          setLive((prev) =>
            prev === null ? prev : { ...prev, phase: "cancelled" },
          );
          break;
        }
        case "run.completed": {
          // The final message is stored before the event (S7): once the
          // history has it, the live copy steps aside so nothing doubles up.
          void queryClient
            .invalidateQueries({ queryKey: ["conversation"] })
            .then(() => {
              setLiveMessages([]);
              setLive(null);
            });
          break;
        }
        default:
          // thinking.delta, tool and usage events: the answer text is the
          // message text only, so thinking never mixes into it (§10).
          break;
      }
    },
    [queryClient],
  );

  const applyEnd = useCallback(
    (end: RunStreamEnd) => {
      if (end.kind !== "failed") return;
      // A spinner never survives a stream that gave up (S9): the sentence
      // comes from the API; without one, the local fallback speaks.
      setPendingUser(null);
      setLive((prev) =>
        prev === null || prev.phase === "failed"
          ? prev
          : { ...prev, phase: "failed", error: end.message ?? sendError },
      );
    },
    [sendError],
  );

  // Demo 1's criterion: reloading mid-answer loses nothing. The URL names
  // the run; the replay rebuilds the answer, and already-applied sequences
  // are skipped, so no text renders twice (S6).
  useEffect(() => {
    if (initialRun === null) return;
    const controller = new AbortController();
    streamRef.current = controller;
    setLive({ runId: initialRun, phase: "connecting", error: null });
    openRunStream(
      { kind: "replay", runId: initialRun },
      { onEvent: applyEvent, onEnd: applyEnd },
      controller.signal,
      { fromSeq: lastSeqRef.current },
    );
    return () => {
      controller.abort();
      if (streamRef.current === controller) streamRef.current = null;
    };
  }, [initialRun, applyEvent, applyEnd]);

  const messages = useConversationMessages(conversationId, sendError);

  const history = useMemo(() => {
    const liveIds = new Set(liveMessages.map((item) => item.id));
    return (messages.data?.pages ?? [])
      .flatMap((page) => page.messages)
      .filter((message) => !liveIds.has(message.id));
  }, [messages.data, liveMessages]);

  // Pages move forward in time; catch up so the tail is not stuck on the
  // first hundred messages.
  useEffect(() => {
    if (messages.hasNextPage && !messages.isFetchingNextPage) {
      void messages.fetchNextPage();
    }
  }, [
    messages.hasNextPage,
    messages.isFetchingNextPage,
    messages.fetchNextPage,
  ]);

  // The optimistic user bubble steps aside once the endpoint carries it.
  useEffect(() => {
    const pending = pendingUser;
    if (pending === null) return;
    const stored = (messages.data?.pages ?? []).some((page) =>
      page.messages.some(
        (message) => message.role === "user" && message.content === pending,
      ),
    );
    if (stored) setPendingUser(null);
  }, [messages.data, pendingUser]);

  const startRun = useCallback(
    async (agent: string, text: string): Promise<void> => {
      setLive({ runId: null, phase: "connecting", error: null });
      setPendingUser(text);
      setLiveMessages([]);
      lastSeqRef.current = 0;
      agentIdRef.current = agent;
      try {
        let current = conversationIdRef.current;
        if (current === null) {
          const created = await createConversation(agent, sendError);
          current = created.id;
          setConversationId(created.id);
          conversationIdRef.current = created.id;
        }
        replaceUrl(agent, current, null);
        const controller = new AbortController();
        streamRef.current = controller;
        openRunStream(
          {
            kind: "create",
            body: { agentId: agent, conversationId: current, input: text },
          },
          { onEvent: applyEvent, onEnd: applyEnd },
          controller.signal,
        );
      } catch (error) {
        setPendingUser(null);
        setLive({
          runId: null,
          phase: "failed",
          error: userMessage(error, sendError),
        });
      }
    },
    [applyEnd, applyEvent, sendError],
  );

  const cancel = useCallback((): void => {
    const runId = live?.runId ?? null;
    if (runId === null) return;
    void cancelRun(runId, cancelError).catch(() => undefined);
  }, [cancelError, live]);

  /** The agent changed: drop the conversation and any answer in flight. */
  const resetConversation = useCallback((agent: string | null): void => {
    agentIdRef.current = agent;
    setConversationId(null);
    conversationIdRef.current = null;
    setPendingUser(null);
    setLive(null);
    setLiveMessages([]);
    streamRef.current?.abort();
    streamRef.current = null;
  }, []);

  const isAnswering =
    live?.phase === "connecting" || live?.phase === "streaming";

  return {
    history,
    isAnswering,
    live,
    liveMessages,
    messagesIsError: messages.isError,
    pendingUser,
    refetchMessages: useCallback(
      () => void messages.refetch(),
      [messages.refetch],
    ),
    resetConversation,
    startRun,
    stop: cancel,
  } satisfies {
    history: MessageResponse[];
    isAnswering: boolean;
    live: LiveRun | null;
    liveMessages: LiveMessage[];
    messagesIsError: boolean;
    pendingUser: string | null;
    refetchMessages: () => void;
    resetConversation: (agent: string | null) => void;
    startRun: (agent: string, text: string) => Promise<void>;
    stop: () => void;
  };
}
