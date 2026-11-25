"use client";

import type { AgentResponse } from "@middleware/contracts";
import { Card } from "@middleware/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

/**
 * The agent column of the chat: the picker plus its loading, error and empty
 * states. What the conversation does with the chosen agent stays in the
 * screen; this component only speaks for the picker.
 */
export function AgentPicker({
  agents,
  agentId,
  onChange,
}: {
  agents: UseQueryResult<AgentResponse[], Error>;
  agentId: string | null;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const t = useTranslations("chat");

  return (
    <>
      {agents.isError ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <p className="text-body text-ink">{t("agentsError")}</p>
          <button
            className="min-h-11 rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
            onClick={() => void agents.refetch()}
            type="button"
          >
            {t("retry")}
          </button>
        </Card>
      ) : null}
      <Card className="p-3">
        <label className="flex items-center gap-3 text-small text-ink-2">
          <span className="shrink-0">{t("agentLabel")}</span>
          <select
            aria-label={t("agentLabel")}
            className="min-h-11 flex-1 rounded-field bg-raised px-3 text-body text-ink shadow-raised"
            disabled={agents.isPending}
            onChange={onChange}
            value={agentId ?? ""}
          >
            <option value="">{t("agentPlaceholder")}</option>
            {(agents.data ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      </Card>
      {agentId === null ? (
        agents.data !== undefined && agents.data.length === 0 ? (
          <Card className="space-y-2 p-6 text-center">
            <h2 className="text-heading font-medium text-ink">
              {t("noAgentsTitle")}
            </h2>
            <p className="text-small text-ink-2">{t("noAgentsBody")}</p>
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
              href="/agents"
            >
              {t("noAgentsAction")}
            </Link>
          </Card>
        ) : (
          <Card className="space-y-2 p-6 text-center">
            <h2 className="text-heading font-medium text-ink">
              {t("chooseAgentTitle")}
            </h2>
            <p className="text-small text-ink-2">{t("chooseAgentBody")}</p>
          </Card>
        )
      ) : null}
    </>
  );
}
