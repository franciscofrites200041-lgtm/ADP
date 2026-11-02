import { z } from "zod";

import { providerCatalog, providerIdSchema } from "./providers.ts";

const aliasSchema = z.string().trim().min(1).max(255);

export const credentialStatusSchema = z.enum(["unchecked", "valid", "invalid"]);
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

/** Only https base URLs; the SSRF-safe client that calls them is WP-14. */
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
