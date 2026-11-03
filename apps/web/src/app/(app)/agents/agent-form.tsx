"use client";

import type {
  AgentResponse,
  AgentTemplate,
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
  /** A starting point: prefills the fields, still editable (WP-21). */
  template?: AgentTemplate;
  /** Present means "edit this agent": saving appends a new version. */
  agent?: AgentResponse;
  onDone?: () => void;
};

/** Create an agent, or edit it into a new version. One form, one rule. */
export function AgentForm({ credentials, agent, template, onDone }: FormProps) {
  const t = useTranslations("agents");
  const fallback = t("errorAction");
  const create = useCreateAgent(fallback);
  const update = useUpdateAgent(fallback);
  const [name, setName] = useState(agent?.name ?? template?.name ?? "");
  const [instructions, setInstructions] = useState(
    agent?.currentVersion?.instructions ?? template?.instructions ?? "",
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
      // Editing must keep what the agent already has: falling back to the
      // template would wipe params and tools on every save.
      params: agent?.currentVersion?.params ?? template?.suggestedParams ?? {},
      tools: agent?.currentVersion?.tools ?? template?.suggestedTools ?? [],
    };
    if (agent) {
      const input: UpdateAgentInput = { id: agent.id, name, version };
      update.mutate(input, { onSuccess: () => onDone?.() });
      return;
    }
    create.mutate(
      {
        name,
        version,
        ...(template === undefined ? {} : { templateId: template.id }),
      },
      { onSuccess: () => onDone?.() },
    );
  };

  const error = create.error ?? update.error;

  return (
    <Card className="space-y-3 p-5">
      <p className="text-body font-medium text-ink">
        {agent
          ? t("editTitle")
          : template
            ? t("fromTemplateTitle", { name: template.name })
            : t("formTitle")}
      </p>
      <form className="space-y-3" onSubmit={submit}>
        <Field
          label={t("name")}
          hint={t("nameHint")}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="block text-small font-medium text-ink-2">
          {t("credential")}
          <select
            className="mt-2 min-h-11 w-full rounded-field bg-raised px-4 text-body text-ink shadow-raised"
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
          <span className="mt-1 block text-small text-muted">
            {t("credentialHint")}
          </span>
        </label>
        <label className="block text-small font-medium text-ink-2">
          {t("model")}
          <select
            className="mt-2 min-h-11 w-full rounded-field bg-raised px-4 text-body text-ink shadow-raised"
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
          <span className="mt-1 block text-small text-muted">
            {t("modelHint")}
          </span>
        </label>
        <label className="block text-small font-medium text-ink-2">
          {t("instructions")}
          <textarea
            className="mt-2 min-h-32 w-full rounded-field bg-raised px-4 py-2 text-body text-ink shadow-raised"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <span className="mt-1 block text-small text-muted">
            {t("instructionsHint")}
          </span>
        </label>
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
