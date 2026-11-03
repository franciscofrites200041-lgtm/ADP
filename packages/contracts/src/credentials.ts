import { z } from "zod";

import { providerCatalog, providerIdSchema } from "./providers.ts";

// No control characters (NUL, newlines, tabs, DEL): Postgres rejects NUL and
// the others would break logs and the UI. Accents, emoji and spaces are fine.
const aliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\p{Cc}]+$/u);

export const credentialStatusSchema = z.enum(["unchecked", "valid", "invalid"]);
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

/** Only https base URLs; the SSRF-safe client that calls them is WP-14. */
// Developer-facing validation text only: apps/api/src/http-errors.ts maps every
// ZodError to the  code and takes the user message from
// messages.ts, so no string in this file is ever rendered to a user.
export const createCredentialRequestSchema = z
  .strictObject({
    providerId: providerIdSchema,
    alias: aliasSchema,
    apiKey: z.string().trim().min(8),
    baseUrl: z.url({ protocol: /^https$/ }).optional(),
  })
  .refine(
    (input) =>
      providerCatalog.some(
        (provider) =>
          provider.id === input.providerId &&
          provider.needsBaseUrl === (input.baseUrl !== undefined),
      ),
    {
      path: ["baseUrl"],
      message: "baseUrl is required only for openai-compatible",
    },
  );
export type CreateCredentialRequest = z.infer<
  typeof createCredentialRequestSchema
>;

export const renameCredentialRequestSchema = z.strictObject({
  alias: aliasSchema,
});
export type RenameCredentialRequest = z.infer<
  typeof renameCredentialRequestSchema
>;

export const credentialIdParamSchema = z.strictObject({ id: z.uuid() });

/** The public view of a credential (S2): never the key nor its ciphertext. */
export const credentialResponseSchema = z.strictObject({
  id: z.uuid(),
  providerId: providerIdSchema,
  alias: z.string(),
  last4: z.string().length(4),
  status: credentialStatusSchema,
  baseUrl: z.string().nullable(),
});
export type CredentialResponse = z.infer<typeof credentialResponseSchema>;

export const credentialListResponseSchema = z.strictObject({
  credentials: z.array(credentialResponseSchema),
});
export type CredentialListResponse = z.infer<
  typeof credentialListResponseSchema
>;

/**
 * Why a connection test failed. The Spanish text lives in the app catalogs
 * (apps/api/src/messages.ts and the web one), never in the contract: the domain
 * carries codes, the edge that renders text owns the wording.
 */
export const credentialTestCodeSchema = z.enum([
  "invalid_key",
  "provider_unreachable",
  "rate_limited",
  "provider_error",
]);
export type CredentialTestCode = z.infer<typeof credentialTestCodeSchema>;

/**
 * Result of probing a credential (WP-12). A probe either works or fails with a
 * reason; `code` is present exactly when the status is `invalid`, so a caller
 * cannot show "invalid" without saying why.
 */
export const credentialTestResponseSchema = z
  .strictObject({
    status: z.enum(["valid", "invalid"]),
    code: credentialTestCodeSchema.nullable(),
  })
  .refine(
    (result) => (result.status === "valid") === (result.code === null),
    {
      path: ["code"],
      message: "code is null exactly when the credential is valid",
    },
  );
export type CredentialTestResponse = z.infer<
  typeof credentialTestResponseSchema
>;
