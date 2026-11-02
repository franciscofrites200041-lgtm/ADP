import { z } from "zod";

import { providerIdSchema } from "./providers.ts";

/** Where a model comes from; the catalog is pi-ai's, not ours (D2). */
export const modelDescriptorSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  providerId: providerIdSchema,
  contextWindow: z.number().int().positive().nullable(),
  maxTokens: z.number().int().positive().nullable(),
  reasoning: z.boolean(),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const modelListResponseSchema = z.strictObject({
  models: z.array(modelDescriptorSchema),
});
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;

/**
 * §10 provider error catalog. Kept apart from `errorCodeSchema` (the HTTP
 * catalog) because these come from the model layer and reach the run, not the
 * credential routes.
 */
export const providerErrorCodeSchema = z.enum([
  "invalid_api_key",
  "insufficient_quota",
  "rate_limited",
  "model_not_found",
  "context_too_long",
  "provider_timeout",
  "provider_unavailable",
  "content_filtered",
  "tool_failed",
  "run_timeout",
  "limit_reached",
  "unknown",
]);
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;
