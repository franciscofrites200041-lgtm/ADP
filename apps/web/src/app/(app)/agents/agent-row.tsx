"use client";

import type { AgentResponse } from "@middleware/contracts";
import { Badge, RaisedRow } from "@middleware/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { userMessage } from "../../../shared/api-client.ts";
import {
  type ArchiveInput,
  type DuplicateInput,
  useAgentVersions,
  useRestoreAgentVersion,
} from "./queries.ts";

type RowProps = {
  agent: AgentResponse;
  archive: {
    mutate: (input: ArchiveInput, options?: { onSuccess?: () => void }) => void;
    error: Error | null;
    variables?: ArchiveInput | undefined;
    isPending: boolean;
  };
  duplicate: {
    mutate: (
      input: DuplicateInput,
      options?: { onSuccess?: () => void },
    ) => void;
    error: Error | null;
    variables?: DuplicateInput | undefined;
    isPending: boolean;
  };
  onEdit: () => void;
};

/** One agent: name, current version, and the actions that keep history honest. */
export function AgentRow({ agent, archive, duplicate, onEdit }: RowProps) {
  const t = useTranslations("agents");
  const fallback = t("errorAction");
  const [showVersions, setShowVersions] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [copyName, setCopyName] = useState(
    t("duplicateDefaultName", { name: agent.name }),
  );
  const versions = useAgentVersions(showVersions ? agent.id : null, fallback);
  const restore = useRestoreAgentVersion(fallback);

  const rowError =
    (restore.variables?.id === agent.id ? restore.error : null) ??
    (archive.variables?.id === agent.id ? archive.error : null) ??
    (duplicate.variables?.id === agent.id ? duplicate.error : null);

  return (
    <RaisedRow className="flex flex-wrap items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">{agent.name}</p>
        <p className="text-small text-ink-2">
          {agent.currentVersion
            ? t("versionLine", {
                version: agent.currentVersion.version,
                model: agent.currentVersion.modelId,
              })
            : t("noVersion")}
        </p>
      </div>
      <Badge tone={agent.currentVersion ? "success" : "neutral"}>
        {agent.currentVersion ? t("ready") : t("draft")}
      </Badge>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
          onClick={onEdit}
        >
          {t("edit")}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
          onClick={() => setShowVersions((open) => !open)}
        >
          {t("versions")}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
          onClick={() => setIsDuplicating(true)}
        >
          {t("duplicate")}
        </button>
        <button
          type="button"
          className="min-h-11 px-2 text-small text-ink-2"
          onClick={() => archive.mutate({ id: agent.id })}
        >
          {t("archive")}
        </button>
      </div>

      {isDuplicating ? (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            duplicate.mutate(
              { id: agent.id, name: copyName },
              { onSuccess: () => setIsDuplicating(false) },
            );
          }}
        >
          <input
            className="min-h-11 min-w-0 flex-1 rounded-field bg-surface-2 px-3 text-body text-ink"
            aria-label={t("duplicateName")}
            value={copyName}
            onChange={(event) => setCopyName(event.target.value)}
          />
          <button
            type="submit"
            className="min-h-11 rounded-field bg-raised px-3 text-small shadow-raised"
          >
            {t("duplicateConfirm")}
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-small text-ink-2"
            onClick={() => setIsDuplicating(false)}
          >
            {t("cancel")}
          </button>
        </form>
      ) : null}

      {showVersions ? (
        <div className="w-full space-y-2">
          {versions.isPending ? (
            <p className="text-small text-ink-2">{t("versionsLoading")}</p>
          ) : null}
          {(versions.data ?? []).map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center gap-2 rounded-field bg-surface-2 px-3 py-2"
            >
              <span className="text-small text-ink">
                {t("versionLabel", { version: version.version })}
              </span>
              <span className="min-w-0 flex-1 truncate text-small text-ink-2">
                {version.instructions}
              </span>
              <button
                type="button"
                className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate({ id: agent.id, versionId: version.id })
                }
              >
                {t("restore")}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {rowError ? (
        <p className="w-full text-small text-danger" role="alert">
          {userMessage(rowError, fallback)}
        </p>
      ) : null}
    </RaisedRow>
  );
}
