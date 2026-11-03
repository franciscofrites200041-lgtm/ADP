"use client";

import {
  type CredentialResponse,
  credentialListResponseSchema,
} from "@middleware/contracts";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import { requestJson } from "./api-client.ts";

const LIST_KEY = ["credentials"] as const;

/**
 * Validated list from the API. A body that does not match the contract becomes
 * an error instead of rendering half a table (the schemas are strict, so a
 * response carrying `apiKey` or `ciphertext` is rejected here).
 */
export function parseCredentialList(input: unknown): CredentialResponse[] {
  return credentialListResponseSchema.parse(input).credentials;
}

/**
 * The workspace's credentials. Shared by Providers and Agents: two routes, so
 * the Scope Rule puts it here, and both share one cache key.
 */
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

export { LIST_KEY as CREDENTIALS_KEY };
