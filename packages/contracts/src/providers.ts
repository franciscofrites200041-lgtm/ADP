import { z } from "zod";

export const providerIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "xai",
  "openrouter",
  "openai-compatible",
]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const providerSchema = z.strictObject({
  id: providerIdSchema,
  label: z.string(),
  needsBaseUrl: z.boolean(),
});
export type Provider = z.infer<typeof providerSchema>;

/** Supported model providers (`GET /api/providers`), until WP-11 brings pi-ai. */
export const providerCatalog: readonly Provider[] = [
  { id: "openai", label: "OpenAI", needsBaseUrl: false },
  { id: "anthropic", label: "Anthropic", needsBaseUrl: false },
  { id: "google", label: "Google", needsBaseUrl: false },
  { id: "xai", label: "xAI", needsBaseUrl: false },
  { id: "openrouter", label: "OpenRouter", needsBaseUrl: false },
  {
    id: "openai-compatible",
    label: "Compatible con OpenAI",
    needsBaseUrl: true,
  },
];
