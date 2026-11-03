"use client";

import type { AgentResponse } from "@middleware/contracts";
import { Card } from "@middleware/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { userMessage } from "../../../shared/api-client.ts";
import { AgentForm } from "./agent-form.tsx";
import { AgentRow } from "./agent-row.tsx";
import {
  useAgents,
  useArchiveAgent,
  useCredentialPicker,
  useDuplicateAgent,
} from "./queries.ts";

/** The Agents screen: the list, the create form and the editor. */
export function AgentsScreen() {
  const t = useTranslations("agents");
  const fallback = t("errorTitle");
  const agents = useAgents(fallback);
  const credentials = useCredentialPicker(fallback);
  const archive = useArchiveAgent(fallback);
  const duplicate = useDuplicateAgent(fallback);
  const [editing, setEditing] = useState<AgentResponse | null>(null);

  const availableCredentials = credentials.data ?? [];
  const hasCredentials = availableCredentials.length > 0;

  return (
    <div className="space-y-4">
      {hasCredentials ? (
        <AgentForm
          key={editing?.id ?? "new"}
          credentials={availableCredentials}
          {...(editing ? { agent: editing } : {})}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Card className="space-y-2 p-5">
          <p className="text-body text-ink">{t("needsCredentialTitle")}</p>
          <p className="text-small text-ink-2">{t("needsCredentialBody")}</p>
        </Card>
      )}

      {agents.isPending ? (
        <p className="text-body text-ink-2" role="status">
          {t("loading")}
        </p>
      ) : null}

      {agents.isError ? (
        <Card className="space-y-3 p-5">
          <p className="text-body text-ink">{t("errorTitle")}</p>
          <p className="text-small text-ink-2">
            {userMessage(agents.error, fallback)}
          </p>
          <button
            type="button"
            className="min-h-11 rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
            onClick={() => void agents.refetch()}
          >
            {t("retry")}
          </button>
        </Card>
      ) : null}

      {agents.data?.length === 0 ? (
        <Card className="space-y-2 p-5">
          <p className="text-body font-medium text-ink">{t("emptyTitle")}</p>
          <p className="text-small text-ink-2">{t("emptyBody")}</p>
        </Card>
      ) : null}

      <div className="space-y-3">
        {(agents.data ?? []).map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            archive={archive}
            duplicate={duplicate}
            onEdit={() => setEditing(agent)}
          />
        ))}
      </div>
    </div>
  );
}
