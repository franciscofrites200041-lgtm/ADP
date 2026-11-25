"use client";

import type { MessageResponse } from "@middleware/contracts";
import { ChatBubble } from "@middleware/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

/** One agent answer being written live, keyed by its message id. */
export type LiveMessage = { id: string; text: string };

/** Appends a delta to the live answer, starting one when the id is new. */
export function appendLive(
  list: LiveMessage[],
  id: string,
  text: string,
): LiveMessage[] {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return [...list, { id, text }];
  const next = [...list];
  const current = next[index];
  if (current !== undefined) {
    next[index] = { ...current, text: current.text + text };
  }
  return next;
}

/** A completed message carries its full content: it replaces the deltas. */
export function replaceLiveText(
  list: LiveMessage[],
  id: string,
  text: string,
): LiveMessage[] {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return [...list, { id, text }];
  const next = [...list];
  next[index] = { id, text };
  return next;
}

export type LivePhase = "connecting" | "streaming" | "failed" | "cancelled";

type ChatTranscriptProps = {
  history: MessageResponse[];
  pendingUser: string | null;
  liveMessages: LiveMessage[];
  phase: LivePhase | null;
  errorMessage: string | null;
};

/**
 * The message column of the chat screen. The history comes from the
 * conversation endpoint (S11); the live answer is rebuilt from run events
 * (S8), and thinking is never part of it (§10: it is a separate event type).
 */
export function ChatTranscript({
  history,
  pendingUser,
  liveMessages,
  phase,
  errorMessage,
}: ChatTranscriptProps) {
  const t = useTranslations("chat");
  const scroller = useRef<HTMLDivElement | null>(null);

  // New content lands at the bottom; the reader follows it. The props are
  // scroll triggers on purpose: the effect reads the node, not them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll triggers, not values to read
  useEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [history, pendingUser, liveMessages, phase, errorMessage]);

  const isEmpty =
    history.length === 0 && pendingUser === null && liveMessages.length === 0;

  return (
    <div
      aria-live="polite"
      className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto rounded-card bg-surface p-4"
      ref={scroller}
    >
      {isEmpty ? (
        <p className="px-1 py-6 text-center text-small text-muted">
          {t("emptyConversation")}
        </p>
      ) : null}
      {history.map((message) => (
        <ChatBubble
          author={message.role === "user" ? "user" : "agent"}
          className="text-body"
          key={message.id}
        >
          {message.content}
        </ChatBubble>
      ))}
      {pendingUser === null ? null : (
        <ChatBubble author="user" className="text-body">
          {pendingUser}
        </ChatBubble>
      )}
      {liveMessages.map((message) => (
        <ChatBubble author="agent" className="text-body" key={message.id}>
          {message.text}
        </ChatBubble>
      ))}
      {phase === "connecting" || phase === "streaming" ? (
        <p className="px-1 text-small text-muted" role="status">
          {t("thinking")}
        </p>
      ) : null}
      {phase === "failed" && errorMessage !== null ? (
        <p
          className="rounded-field bg-raised px-3 py-2 text-small text-danger shadow-raised"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      {phase === "cancelled" ? (
        <p className="px-1 text-small text-muted">{t("cancelledNote")}</p>
      ) : null}
    </div>
  );
}
