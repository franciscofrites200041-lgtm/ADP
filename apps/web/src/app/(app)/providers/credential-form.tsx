"use client";

import {
  type CreateCredentialRequest,
  type CredentialResponse,
  createCredentialRequestSchema,
  providerCatalog,
  providerIdSchema,
} from "@middleware/contracts";
import { Card, Field, PillRadio, RaisedRow } from "@middleware/ui";
import type { UseMutationResult } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";

import { needsBaseUrl } from "./providers-helpers.ts";
import { userMessage } from "./queries.ts";

type FormValues = {
  providerId: string;
  alias: string;
  apiKey: string;
  baseUrl: string;
};

/** Create form. Validates with the shared contract schema; no resolver dependency. */
export function CredentialForm({
  mutation,
}: Readonly<{
  mutation: UseMutationResult<
    CredentialResponse,
    Error,
    CreateCredentialRequest
  >;
}>) {
  const t = useTranslations("providers");
  const groupId = useId();
  const { register, handleSubmit, reset, watch, setError, formState } =
    useForm<FormValues>({
      defaultValues: {
        providerId: providerCatalog[0]?.id ?? "openai",
        alias: "",
        apiKey: "",
        baseUrl: "",
      },
    });
  const [done, setDone] = useState(false);
  const providerId = watch("providerId");
  // Validated, not cast: an unknown provider simply hides the base URL field.
  const parsedProvider = providerIdSchema.safeParse(providerId);
  const wantsBaseUrl = parsedProvider.success
    ? needsBaseUrl(parsedProvider.data)
    : false;

  async function onSubmit(values: FormValues) {
    setDone(false);
    const parsed = createCredentialRequestSchema.safeParse({
      providerId: values.providerId,
      alias: values.alias,
      apiKey: values.apiKey,
      ...(wantsBaseUrl && values.baseUrl ? { baseUrl: values.baseUrl } : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "alias" || field === "apiKey" || field === "baseUrl") {
          setError(field, { message: t("invalid") });
        }
      }
      return;
    }
    try {
      await mutation.mutateAsync(parsed.data);
      reset({ ...values, alias: "", apiKey: "", baseUrl: "" });
      setDone(true);
    } catch {
      // The error is rendered from mutation.error; nothing to do here.
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-heading font-medium text-ink">{t("formTitle")}</h2>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <fieldset className="space-y-2">
          <legend className="text-small font-medium text-ink-2">
            {t("provider")}
          </legend>
          <div className="flex flex-wrap gap-2" id={groupId}>
            {providerCatalog.map((provider) => (
              <PillRadio
                key={provider.id}
                value={provider.id}
                {...register("providerId")}
              >
                {provider.label}
              </PillRadio>
            ))}
          </div>
        </fieldset>
        <RaisedRow className="space-y-3 p-4">
          <Field
            label={t("alias")}
            hint={t("aliasHint")}
            error={formState.errors.alias?.message}
            {...register("alias")}
          />
          <Field
            label={t("apiKey")}
            hint={t("apiKeyHint")}
            type="password"
            autoComplete="off"
            error={formState.errors.apiKey?.message}
            {...register("apiKey")}
          />
          {wantsBaseUrl ? (
            <Field
              label={t("baseUrl")}
              hint={t("baseUrlHint")}
              type="url"
              error={formState.errors.baseUrl?.message}
              {...register("baseUrl")}
            />
          ) : null}
        </RaisedRow>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="min-h-11 rounded-field bg-accent px-5 font-medium text-on-accent shadow-accent"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t("submitting") : t("submit")}
          </button>
          {done ? (
            <p className="text-small text-ink-2" role="status">
              {t("created")}
            </p>
          ) : null}
          {mutation.error ? (
            <p className="text-small text-danger" role="alert">
              {userMessage(mutation.error, t("errorTitle"))}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
