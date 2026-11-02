"use client";

import { Card } from "@middleware/ui";
import { useTranslations } from "next-intl";

import { CredentialForm } from "./credential-form.tsx";
import { CredentialRow } from "./credential-row.tsx";
import {
  useArchiveCredential,
  useCreateCredential,
  useCredentials,
  useRenameCredential,
  userMessage,
} from "./queries.ts";

/** The Providers screen: list, states and the create form. */
export function ProvidersScreen() {
  const t = useTranslations("providers");
  const fallback = t("errorTitle");
  const list = useCredentials(fallback);
  const create = useCreateCredential(fallback);
  const rename = useRenameCredential(fallback);
  const archive = useArchiveCredential(fallback);

  return (
    <div className="space-y-4">
      <CredentialForm mutation={create} />

      {list.isPending ? (
        <p className="text-body text-ink-2" role="status">
          {t("loading")}
        </p>
      ) : null}

      {list.isError ? (
        <Card className="space-y-3 p-5">
          <p className="text-body text-ink">{t("errorTitle")}</p>
          <p className="text-small text-ink-2">
            {userMessage(list.error, fallback)}
          </p>
          <button
            type="button"
            className="min-h-11 rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
            onClick={() => void list.refetch()}
          >
            {t("retry")}
          </button>
        </Card>
      ) : null}

      {list.data?.length === 0 ? (
        <Card className="space-y-2 p-6 text-center">
          <h2 className="text-heading font-medium text-ink">
            {t("emptyTitle")}
          </h2>
          <p className="text-small text-ink-2">{t("emptyDescription")}</p>
        </Card>
      ) : null}

      {list.data && list.data.length > 0 ? (
        <section className="space-y-2" aria-label={t("listTitle")}>
          <h2 className="px-1 text-small font-medium text-muted">
            {t("listTitle")}
          </h2>
          {list.data.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              rename={rename}
              archive={archive}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
