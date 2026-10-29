/**
 * Provider credential variables that `pi-ai` reads implicitly when no explicit
 * key is passed (see `getApiKeyEnvVars` / `getEnvApiKey` in
 * `@earendil-works/pi-ai` 1.4.0 `env-api-keys.js`), plus the names listed in
 * MIDDLEWARE_MASTER.md §8 S5. Provider keys must only ever be passed
 * explicitly per execution, so API and worker refuse to start if any exist.
 *
 * Re-audit this list whenever `pi-ai` is upgraded.
 */
export const PROVIDER_CREDENTIAL_ENV_VARS: readonly string[] = [
  // Master document S5
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  // pi-ai: Anthropic
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
  // pi-ai: other providers
  "COPILOT_GITHUB_TOKEN",
  "ANT_LING_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY",
  "QWEN_TOKEN_PLAN_CN_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "DEEPSEEK_API_KEY",
  "GOOGLE_CLOUD_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "TYPESAFE_API_KEY",
  "RADIUS_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_CN_API_KEY",
  "MISTRAL_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MOONSHOT_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "TOGETHER_API_KEY",
  "BASETEN_API_KEY",
  "OPENCODE_API_KEY",
  "KIMI_API_KEY",
  "META_API_KEY",
  "CLOUDFLARE_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  // pi-ai: Vertex ADC and Amazon Bedrock credential sources
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
];

export class ProviderKeyEnvError extends Error {
  readonly code = "PROVIDER_KEY_ENV_PRESENT";

  constructor(readonly vars: readonly string[]) {
    // Names only; values are never included.
    super(`Provider credential variables must not be set: ${vars.join(", ")}`);
    this.name = "ProviderKeyEnvError";
  }
}

/** Throws if any known provider credential variable is present (even empty). */
export function assertNoProviderKeys(env: NodeJS.ProcessEnv): void {
  const found = PROVIDER_CREDENTIAL_ENV_VARS.filter(
    (name) => env[name] !== undefined,
  );
  if (found.length > 0) throw new ProviderKeyEnvError(found);
}
