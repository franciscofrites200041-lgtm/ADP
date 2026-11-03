"use client";

import type {
  CredentialResponse,
  CredentialTestResponse,
} from "@middleware/contracts";
import { Badge, IconTile, RaisedRow } from "@middleware/ui";
import type { UseMutationResult } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  maskLast4,
  providerLabel,
  providerMonogram,
} from "./providers-helpers.ts";
import {
  type ArchiveInput,
  type RenameInput,
  type TestInput,
  userMessage,
} from "./queries.ts";

type RowProps = {
  credential: CredentialResponse;
  rename: UseMutationResult<CredentialResponse, Error, RenameInput>;
  archive: UseMutationResult<void, Error, ArchiveInput>;
  test: UseMutationResult<CredentialTestResponse, Error, TestInput>;
};

const statusTone = {
  unchecked: "neutral",
  valid: "success",
  invalid: "danger",
} as const;

/** One credential: alias, masked key, status, and inline rename/archive. */
export function CredentialRow({ credential, rename, archive, test }: RowProps) {
  const t = useTranslations("providers");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [alias, setAlias] = useState(credential.alias);
  // Only the outcome of the test aimed at THIS row.
  const outcome = test.variables?.id === credential.id ? test.data : undefined;
  // Only the error of a mutation aimed at THIS row.
  const rowError =
    (rename.variables?.id === credential.id ? rename.error : null) ??
    (archive.variables?.id === credential.id ? archive.error : null) ??
    (test.variables?.id === credential.id ? test.error : null);

  return (
    <RaisedRow className="flex flex-wrap items-center gap-3 p-4">
      <IconTile aria-hidden="true">
        {providerMonogram(credential.providerId)}
      </IconTile>
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate(
                { id: credential.id, alias },
                { onSuccess: () => setIsRenaming(false) },
              );
            }}
          >
            <input
              className="min-h-11 min-w-0 flex-1 rounded-field bg-surface-2 px-3 text-body text-ink"
              aria-label={t("rename")}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
            />
            <button
              type="submit"
              className="min-h-11 rounded-field bg-raised px-3 shadow-raised"
            >
              {t("renameSave")}
            </button>
            <button
              type="button"
              className="min-h-11 px-2 text-small text-ink-2"
              onClick={() => {
                setAlias(credential.alias);
                setIsRenaming(false);
              }}
            >
              {t("renameCancel")}
            </button>
          </form>
        ) : (
          <>
            <p className="truncate text-body font-medium text-ink">
              {credential.alias}
            </p>
            <p
              className="font-mono text-small text-ink-2"
              title={t("maskedHint")}
            >
              {t("maskedLine", {
                provider: providerLabel(credential.providerId),
                masked: maskLast4(credential.last4),
              })}
            </p>
            {credential.baseUrl ? (
              <p className="truncate font-mono text-caption text-muted">
                {t("baseUrlLine", { url: credential.baseUrl })}
              </p>
            ) : null}
          </>
        )}
      </div>
      <Badge tone={statusTone[credential.status]}>
        {t(`status.${credential.status}`)}
      </Badge>
      {isConfirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="min-h-11 rounded-field bg-accent-soft px-3 text-small font-medium text-accent-soft-ink"
            onClick={() =>
              archive.mutate(
                { id: credential.id },
                { onSuccess: () => setIsConfirming(false) },
              )
            }
          >
            {t("archiveConfirm")}
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-small text-ink-2"
            onClick={() => setIsConfirming(false)}
          >
            {t("archiveCancel")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
            disabled={test.isPending}
            onClick={() => test.mutate({ id: credential.id })}
          >
            {test.isPending ? t("testing") : t("test")}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-field bg-raised px-3 text-small text-ink shadow-raised"
            onClick={() => setIsRenaming(true)}
          >
            {t("rename")}
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-small text-ink-2"
            onClick={() => setIsConfirming(true)}
          >
            {t("archive")}
          </button>
        </div>
      )}
      {outcome?.status === "invalid" && outcome.code ? (
        <p className="w-full text-small text-danger" role="status">
          {t(`testCodes.${outcome.code}`)}
        </p>
      ) : null}
      {rowError ? (
        <p className="w-full text-small text-danger" role="alert">
          {userMessage(rowError, t("errorTitle"))}
        </p>
      ) : null}
    </RaisedRow>
  );
}
