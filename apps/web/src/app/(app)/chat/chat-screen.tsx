"use client";

import { Composer } from "@middleware/ui";
import { useTranslations } from "next-intl";
import type { ChangeEvent, FormEventHandler } from "react";
import { useState } from "react";

import { AgentPicker } from "./agent-picker.tsx";
import { ChatTranscript } from "./chat-transcript.tsx";
import { useAgentOptions } from "./queries.ts";
import { replaceUrl, useChatRun } from "./use-chat-run.ts";

type ChatScreenProps = {
  /** Validated `?agent=` from the URL, or null. */
  initialAgent: string | null;
  /** Validated `?conversation=` from the URL, or null. */
  initialConversation: string | null;
  /** Validated `?run=` from the URL: the run to rehydrate (S6). */
  initialRun: string | null;
};

/**
 * The chat screen: pick an agent, send, and watch the answer arrive (S1).
 * The run machinery lives in `useChatRun`; this component composes the
 * picker, the transcript and the composer.
 */
export function ChatScreen({
  initialAgent,
  initialConversation,
  initialRun,
}: ChatScreenProps) {
  const t = useTranslations("chat");
  const agents = useAgentOptions(t("agentsError"));
  const [agentId, setAgentId] = useState<string | null>(initialAgent);

  const run = useChatRun({
    cancelError: t("cancelError"),
    initialAgent,
    initialConversation,
    initialRun,
    sendError: t("sendError"),
  });

  const handleSend: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("message");
    if (typeof value !== "string") return;
    const text = value.trim();
    if (text === "" || agentId === null || run.isAnswering) return;
    form.reset();
    void run.startRun(agentId, text);
  };

  const handleAgentChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const id = event.target.value === "" ? null : event.target.value;
    setAgentId(id);
    run.resetConversation(id);
    replaceUrl(id, null, null);
  };

  return (
    <div className="flex flex-col gap-4">
      <AgentPicker
        agentId={agentId}
        agents={agents}
        onChange={handleAgentChange}
      />
      {agentId === null ? null : (
        <>
          <ChatTranscript
            errorMessage={run.live?.error ?? null}
            history={run.history}
            liveMessages={run.liveMessages}
            pendingUser={run.pendingUser}
            phase={run.live?.phase ?? null}
          />
          {run.messagesIsError ? (
            <button
              className="min-h-11 rounded-card bg-surface px-4 py-3 text-left text-small text-ink-2"
              onClick={run.refetchMessages}
              type="button"
            >
              {t("conversationError")} · {t("retry")}
            </button>
          ) : null}
          <Composer
            dictateLabel={t("dictate")}
            disabled={run.isAnswering}
            inputLabel={t("messageLabel")}
            onSubmit={handleSend}
            placeholder={t("placeholder")}
            sendLabel={t("send")}
          />
          {run.isAnswering && run.live !== null && run.live.runId !== null ? (
            <button
              className="min-h-11 self-start rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
              onClick={run.stop}
              type="button"
            >
              {t("stop")}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
