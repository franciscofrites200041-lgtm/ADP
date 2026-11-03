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
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";

import { apiErrorMessage, parseCredentialList } from "./providers-helpers.ts";

const LIST_KEY = ["credentials"] as const;

type CredentialId = z.infer<typeof credentialIdParamSchema>["id"];
/** Path id plus the validated body: both shapes come from the contracts. */
export type RenameInput = RenameCredentialRequest & { id: CredentialId };
export type ArchiveInput = { id: CredentialId };
export type TestInput = { id: CredentialId };

/** Same-origin calls: the session cookie rides along and the API sees the app origin (S10). */
async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (input: unknown) => T,
  fallback: string,
): Promise<T> {
  const response = await fetch(path, withJson(init));
  if (!response.ok) throw new ClientError(await failure(response, fallback));
  try {
    return parse(await response.json());
  } catch {
    // A body that breaks the contract must not show a raw schema error.
    throw new ClientError(fallback);
  }
}

async function requestVoid(
  path: string,
  init: RequestInit,
  fallback: string,
): Promise<void> {
  const response = await fetch(path, withJson(init));
  if (!response.ok) throw new ClientError(await failure(response, fallback));
}

const withJson = (init: RequestInit): RequestInit => {
  // Headers may arrive as a Headers instance, tuples or a record.
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return { ...init, credentials: "include", headers };
};

/** Every error the screen can show, with a message that is already Spanish. */
class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientError";
  }
}

const failure = async (response: Response, fallback: string) =>
  apiErrorMessage(await response.json().catch(() => null), fallback);

/** The text a component may render: never a raw exception message. */
export function userMessage(error: unknown, fallback: string): string {
  return error instanceof ClientError ? error.message : fallback;
}

export function useCredentials(
  fallback: string,
): UseQueryResult<CredentialResponse[], Error> {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () =>
      requestJson(
        "/api/credentials",
        { method: "GET" },
        parseCredentialList,
        fallback,
      ),
  });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: LIST_KEY });
}

export function useCreateCredential(
  fallback: string,
): UseMutationResult<CredentialResponse, Error, CreateCredentialRequest> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input) => {
      // Validated here too: the form is a boundary, and the contracts own the shape.
      const parsed = createCredentialRequestSchema.safeParse(input);
      if (!parsed.success) throw new ClientError(fallback);
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
      if (!parsed.success) throw new ClientError(fallback);
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
