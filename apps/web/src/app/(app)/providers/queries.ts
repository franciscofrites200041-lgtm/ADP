"use client";

import {
  type CreateCredentialRequest,
  type CredentialResponse,
  type CredentialTestResponse,
  createCredentialRequestSchema,
  type credentialIdParamSchema,
  credentialResponseSchema,
  credentialTestResponseSchema,
  type RenameCredentialRequest,
  renameCredentialRequestSchema,
} from "@middleware/contracts";
import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";

import {
  localInputError,
  requestJson,
  requestVoid,
  userMessage,
} from "../../../shared/api-client.ts";
import {
  CREDENTIALS_KEY,
  useCredentials,
} from "../../../shared/credentials.ts";

// Both helpers live in the shared module: providers and agents use them, so
// keeping copies here would break the Scope Rule and split the cache key.
export { useCredentials, userMessage };

type CredentialId = z.infer<typeof credentialIdParamSchema>["id"];
/** Path id plus the validated body: both shapes come from the contracts. */
export type RenameInput = RenameCredentialRequest & { id: CredentialId };
export type ArchiveInput = { id: CredentialId };
export type TestInput = { id: CredentialId };

function useInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: CREDENTIALS_KEY });
}

export function useCreateCredential(
  fallback: string,
): UseMutationResult<CredentialResponse, Error, CreateCredentialRequest> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input) => {
      // Validated here too: the form is a boundary, and the contracts own the shape.
      const parsed = createCredentialRequestSchema.safeParse(input);
      if (!parsed.success) throw localInputError(fallback);
      return requestJson(
        "/api/credentials",
        { method: "POST", body: JSON.stringify(parsed.data) },
        (body) => credentialResponseSchema.parse(body),
        fallback,
      );
    },
    onSuccess: invalidate,
  });
}

export function useRenameCredential(
  fallback: string,
): UseMutationResult<CredentialResponse, Error, RenameInput> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, alias }) => {
      // Validated here too, and the failure is already user-facing Spanish.
      const parsed = renameCredentialRequestSchema.safeParse({ alias });
      if (!parsed.success) throw localInputError(fallback);
      return requestJson(
        `/api/credentials/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(parsed.data) },
        (payload) => credentialResponseSchema.parse(payload),
        fallback,
      );
    },
    onSuccess: invalidate,
  });
}

export function useTestCredential(
  fallback: string,
): UseMutationResult<CredentialTestResponse, Error, TestInput> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id }) =>
      requestJson(
        `/api/credentials/${encodeURIComponent(id)}/test`,
        { method: "POST" },
        (body) => credentialTestResponseSchema.parse(body),
        fallback,
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveCredential(
  fallback: string,
): UseMutationResult<void, Error, ArchiveInput> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id }) =>
      requestVoid(
        `/api/credentials/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        fallback,
      ),
    onSuccess: invalidate,
  });
}
