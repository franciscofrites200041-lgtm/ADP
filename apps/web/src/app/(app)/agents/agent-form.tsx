"use client";

import type {
  AgentResponse,
  CredentialResponse,
  ModelDescriptor,
} from "@middleware/contracts";
import { Card, Field } from "@middleware/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import { userMessage } from "../../../shared/api-client.ts";
import {
  type UpdateAgentInput,
  useCreateAgent,
  useCredentialModels,
  useUpdateAgent,
} from "./queries.ts";

type FormProps = {
  credentials: CredentialResponse[];
  /** Present means "edit this agent": saving appends a new version. */
  agent?: AgentResponse;
  onDone?: () => void;
};

/** Create an agent, or edit it into a new version. One form, one rule. */
export function AgentForm({ credentials, agent, onDone }: FormProps) {
  const t = useTranslations("agents");
  const fallback = t("errorAction");
  const create = useCreateAgent(fallback);
  const update = useUpdateAgent(fallback);
  const [name, setName] = useState(agent?.name ?? "");
  const [instructions, setInstructions] = useState(
    agent?.currentVersion?.instructions ?? "",
  );
  const [credentialId, setCredentialId] = useState(
    agent?.currentVersion?.credentialId ?? "",
  );
  const [modelId, setModelId] = useState(agent?.currentVersion?.modelId ?? "");
  const models = useCredentialModels(credentialId, fallback);

  const credential = credentials.find((item) => item.id === credentialId);
  const canSubmit =
    name.trim() !== "" &&
    instructions.trim() !== "" &&
    credential !== undefined &&
    modelId !== "" &&
    !create.isPending &&
    !update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (credential === undefined) return;
    const version = {
      instructions,
      providerId: credential.providerId,
      modelId,
      credentialId: credential.id,
      params: {},
      tools: [],
    };
    if (agent) {
      const input: UpdateAgentInput = { id: agent.id, name, version };
      update.mutate(input, { onSuccess: () => onDone?.() });
      return;
    }
    create.mutate({ name, version }, { onSuccess: () => onDone?.() });
  };

  const error = create.error ?? update.error;

  return (
    <Card className="space-y-3 p-5">
      <p className="text-body font-medium text-ink">
        {agent ? t("editTitle") : t("formTitle")}
      </p>
      <form className="space-y-3" onSubmit={submit}>
        <Field label={t("name")} hint={t("nameHint")}>
          <input
            className="min-h-11 w-full rounded-field bg-surface-2 px-3 text-body text-ink"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("credential")} hint={t("credentialHint")}>
          <select
            className="min-h-11 w-full rounded-field bg-surface-2 px-3 text-body text-ink"
            value={credentialId}
            onChange={(event) => {
              setCredentialId(event.target.value);
              setModelId("");
            }}
          >
            <option value="">{t("credentialPlaceholder")}</option>
            {credentials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.alias} · {item.last4}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("model")} hint={t("modelHint")}>
          <select
            className="min-h-11 w-full rounded-field bg-surface-2 px-3 text-body text-ink"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            <option value="">
              {models.isPending ? t("modelLoading") : t("modelPlaceholder")}
            </option>
            {(models.data ?? []).map((model: ModelDescriptor) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("instructions")} hint={t("instructionsHint")}>
          <textarea
            className="min-h-32 w-full rounded-field bg-surface-2 px-3 py-2 text-body text-ink"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-11 rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised disabled:opacity-60"
        >
          {agent ? t("save") : t("create")}
        </button>
      </form>
      {error ? (
        <p className="text-small text-danger" role="alert">
          {userMessage(error, fallback)}
        </p>
      ) : null}
    </Card>
  );
}
