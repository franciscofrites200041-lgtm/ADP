import {
  type Api,
  type ApiKeyCredential,
  type AuthContext,
  type CredentialStore,
  createProvider,
  type Model,
  type Provider as PiProvider,
  type ProviderAuth,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ProviderErrorCode } from "@middleware/contracts";
import { DomainError } from "@middleware/core";

/**
 * The provider plumbing `pi-model-gateway` and `agent-runtime` share: one
 * provider id map, one closed auth context and one compatible-provider
 * synthesis, so the two Pi adapters cannot drift apart. Behaviour lives in
 * the adapters; this module only holds the pieces both must agree on.
 */

/**
 * Our provider ids → pi-ai provider ids, in one object: adding a provider is
 * one line, and the compiler forces the line (a new id in the contract makes
 * every lookup stop typechecking until the registry has it).
 *
 * "openai-compatible" resolves to a provider synthesized from the credential's
 * `baseUrl`, built only after the injected `UrlGuard` approves the URL and
 * contacted only through the injected safe fetch (§8).
 */
export const PI_PROVIDER_IDS = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  openrouter: "openrouter",
  "openai-compatible": "openai-compatible",
} as const;

export type OurProviderId = keyof typeof PI_PROVIDER_IDS;

export type PiChatModel = Model<Api>;

/**
 * pi-ai's default auth context reads `process.env` and the filesystem for
 * ambient credentials, which S3 forbids. Every `Models` built on top of this
 * context can only authenticate from the credential of the call or turn.
 */
export const CLOSED_AUTH_CONTEXT: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/** Catalog defaults for compatible endpoints, which advertise no limits. */
export const COMPAT_CONTEXT_WINDOW = 128_000;
export const COMPAT_MAX_TOKENS = 16_384;

/**
 * Auth for the synthesized compatible provider: it resolves only from the
 * per-call credential store, never from the environment (S3).
 */
export const COMPAT_AUTH: ProviderAuth = {
  apiKey: {
    name: "Compatible API key",
    resolve: async ({ credential, signal }) => {
      signal.throwIfAborted();
      const key = credential?.key;
      if (key === undefined || key === "") return undefined;
      return { auth: { apiKey: key }, source: "stored credential" };
    },
  },
};

/**
 * The per-call store is an in-call read-only view (S3); a write to it is a
 * programming error, never a user-facing outcome. `scope` names the lifetime
 * ("per-turn" for the agent runtime, "per-execution" for the gateway) so the
 * developer-facing message says which store refused.
 */
export class ReadOnlyCredentialStoreError extends DomainError {
  constructor(scope: string) {
    super("unknown", `The ${scope} credential store is read-only`);
  }
}

/**
 * A credential store that holds exactly one credential, alive only for one
 * gateway call or agent turn: one `Models` per call, never shared (S3).
 * Read-only, because neither adapter logs in, refreshes OAuth or deletes
 * credentials.
 */
export function singleCredentialStore(
  piProviderId: string,
  apiKey: string,
): CredentialStore {
  const stored: ApiKeyCredential = { type: "api_key", key: apiKey };
  return {
    async read(providerId) {
      return providerId === piProviderId ? stored : undefined;
    },
    async list() {
      return [{ providerId: piProviderId, type: "api_key" }];
    },
    async modify() {
      throw new ReadOnlyCredentialStoreError("per-call");
    },
    async delete() {
      throw new ReadOnlyCredentialStoreError("per-call");
    },
  };
}

/** The synthesized chat model: one per requested id, bound to the base URL. */
export function synthesizeCompatibleModel(
  modelId: string,
  baseUrl: string,
): PiChatModel {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openai-compatible",
    baseUrl,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: COMPAT_CONTEXT_WINDOW,
    maxTokens: COMPAT_MAX_TOKENS,
  };
}

/**
 * One provider per base URL: its catalog is empty (models are synthesized
 * per request), so it is immutable and safe to cache or rebuild per call.
 */
export function createCompatibleProvider(baseUrl: string): PiProvider {
  return createProvider({
    id: "openai-compatible",
    name: "Compatible with OpenAI",
    baseUrl,
    auth: COMPAT_AUTH,
    models: [],
    api: openAICompletionsApi(),
  });
}

/**
 * The §10 codes the Pi adapters produce; the rest of the catalog belongs to
 * the run engine. First match wins, so a message is checked from most to
 * least specific (a 429 that says "quota" must beat the generic rate-limit
 * line).
 */
const FAILURE_PATTERNS: ReadonlyArray<readonly [RegExp, ProviderErrorCode]> = [
  [
    /context (length|window)|maximum context|context_length|too long|too many tokens|prompt is too long/i,
    "context_too_long",
  ],
  [
    /content[-_ ]?filter|content (management )?policy|safety|flagged/i,
    "content_filtered",
  ],
  [
    /\bquota\b|insufficient|billing|payment required|credit balance|\b402\b/i,
    "insufficient_quota",
  ],
  [/rate.?limit|too many requests|\b429\b/i, "rate_limited"],
  [
    /api.?key|apikey|unauthorized|authentication|\b401\b|not configured|permission/i,
    "invalid_api_key",
  ],
  [
    /model.*(does not exist|not (found|available))|no such model|unknown model|\b404\b/i,
    "model_not_found",
  ],
  [/timeout|timed out|\b408\b|deadline exceeded/i, "provider_timeout"],
  [
    /unavailable|overload|\b50[03]\b|\b529\b|internal server error|server error/i,
    "provider_unavailable",
  ],
];

/** Classifies a Pi failure text into the §10 catalog (§10). */
export function mapProviderErrorCode(failure: string): ProviderErrorCode {
  for (const [pattern, code] of FAILURE_PATTERNS) {
    if (pattern.test(failure)) {
      return code;
    }
  }
  return "unknown";
}
