import {
  type Api,
  type ApiKeyCredential,
  type AssistantMessage,
  type AuthContext,
  type CredentialStore,
  calculateCost,
  createModels,
  type Model,
  type MutableModels,
  type Provider as PiProvider,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type {
  ModelCredential,
  ModelGateway,
  ModelTarget,
  ProviderStreamEvent,
} from "@middleware/core";
import { ProviderError } from "@middleware/core";

/**
 * Our provider ids → pi-ai provider ids, in one object: adding a provider is
 * one line, and the compiler forces the line (a new id in the contract makes
 * every lookup stop typechecking until the registry has it).
 *
 * "openai-compatible" is mapped but resolves to no provider until WP-14 wires
 * its per-credential `baseUrl` construction behind the SSRF-safe HTTP client
 * (§8): until then it lists no models and streaming it fails with
 * `model_not_found`.
 */
const PI_PROVIDER_IDS = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  openrouter: "openrouter",
  "openai-compatible": "openai-compatible",
} as const;

type OurProviderId = keyof typeof PI_PROVIDER_IDS;

type PiChatModel = Model<Api>;

/**
 * pi-ai's default auth context reads `process.env` and the filesystem for
 * ambient credentials, which S3 forbids. Every `Models` built here gets this
 * closed context, so auth can only come from the credential of the call.
 */
const CLOSED_AUTH_CONTEXT: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/**
 * The §10 codes this gateway produces; the rest of the catalog belongs to the
 * run engine (WP-30).
 */
type MappedProviderErrorCode =
  | "invalid_api_key"
  | "insufficient_quota"
  | "rate_limited"
  | "model_not_found"
  | "context_too_long"
  | "provider_timeout"
  | "provider_unavailable"
  | "content_filtered"
  | "unknown";

/**
 * First match wins, so a message is checked from most to least specific (a
 * 429 that says "quota" must beat the generic rate-limit line).
 */
const FAILURE_PATTERNS: ReadonlyArray<
  readonly [RegExp, MappedProviderErrorCode]
> = [
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

/** Classifies a pi-ai failure text into the §10 catalog (§10). */
function mapProviderErrorCode(failure: string): MappedProviderErrorCode {
  for (const [pattern, code] of FAILURE_PATTERNS) {
    if (pattern.test(failure)) {
      return code;
    }
  }
  return "unknown";
}

/**
 * Only the code crosses this boundary; the Spanish text lives in the messages
 * file of the layer that renders it, and never the provider's own message, so
 * no secret can leak through an error detail (S2, WP-33).
 */
function providerError(code: MappedProviderErrorCode): ProviderError {
  return new ProviderError(code);
}

function providerErrorFromFailure(failure: AssistantMessage): ProviderError {
  const message =
    failure.errorMessage ?? "The provider request failed without a message";
  return providerError(mapProviderErrorCode(message));
}

/**
 * A credential store that holds exactly one credential, alive only for one
 * gateway call: one `Models` per execution, never shared (S3). Read-only,
 * because the gateway never logs in, refreshes OAuth or deletes credentials.
 */
function singleCredentialStore(
  piProviderId: string,
  credential: ModelCredential,
): CredentialStore {
  const stored: ApiKeyCredential = {
    type: "api_key",
    key: credential.apiKey,
  };
  return {
    async read(providerId) {
      return providerId === piProviderId ? stored : undefined;
    },
    async list() {
      return [{ providerId: piProviderId, type: "api_key" }];
    },
    async modify() {
      throw new Error("The per-execution credential store is read-only");
    },
    async delete() {
      throw new Error("The per-execution credential store is read-only");
    },
  };
}

// The returned shape is checked against the port's ModelDescriptor at every
// call site, so a local annotation would only repeat it.
function toModelDescriptor(providerId: OurProviderId, model: PiChatModel) {
  return {
    id: model.id,
    name: model.name,
    providerId,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
  };
}

/**
 * The pi-ai adapter of the `ModelGateway` port (D2): it owns every pi-ai
 * touchpoint, builds a fresh `Models` per call that holds only that call's
 * credential, and passes the api key explicitly so nothing is ever read from
 * the environment (S3).
 */
export function createPiModelGateway(
  options: { listProviders?: () => readonly PiProvider[] } = {},
): ModelGateway {
  // Provider objects are pi-ai's immutable catalogs, safe to share; only the
  // Models collection and its credential store are per call.
  const piProviders = options.listProviders
    ? options.listProviders()
    : builtinProviders();

  const piProviderFor = (providerId: OurProviderId): PiProvider | undefined => {
    const piId = PI_PROVIDER_IDS[providerId];
    return piProviders.find((candidate) => candidate.id === piId);
  };

  const freshModels = (
    provider: PiProvider,
    credential?: ModelCredential,
  ): MutableModels => {
    const models = createModels(
      credential === undefined
        ? { authContext: CLOSED_AUTH_CONTEXT }
        : {
            credentials: singleCredentialStore(provider.id, credential),
            authContext: CLOSED_AUTH_CONTEXT,
          },
    );
    models.setProvider(provider);
    return models;
  };

  return {
    async listModels({ providerId, credential }) {
      const provider = piProviderFor(providerId);
      if (provider === undefined) {
        return [];
      }
      const models = freshModels(provider, credential);
      return models
        .getModels(provider.id)
        .map((model) => toModelDescriptor(providerId, model));
    },

    findModel(providerId, modelId) {
      const provider = piProviderFor(providerId);
      if (provider === undefined) {
        return null;
      }
      // Sync read of the static catalog: no credential, no network.
      const models = freshModels(provider);
      const model = models.getModel(provider.id, modelId);
      return model === undefined ? null : toModelDescriptor(providerId, model);
    },

    async *stream(target: ModelTarget): AsyncIterable<ProviderStreamEvent> {
      const provider = piProviderFor(target.providerId);
      if (provider === undefined) {
        throw providerError("model_not_found");
      }
      const models = freshModels(provider, target.credential);
      const model = models.getModel(provider.id, target.modelId);
      if (model === undefined) {
        throw providerError("model_not_found");
      }
      // The port's target carries no transcript yet (WP-30 brings the
      // conversation); the key is passed explicitly, never via env (S3).
      const events = models.stream(
        model,
        { messages: [] },
        {
          apiKey: target.credential.apiKey,
        },
      );
      for await (const event of events) {
        if (event.type === "text_delta") {
          yield { type: "text", text: event.delta };
        } else if (event.type === "thinking_delta") {
          yield { type: "thinking", text: event.delta };
        } else if (event.type === "done") {
          const usage = event.message.usage;
          // The faux provider reports a zero cost, so the per-message cost is
          // always computed from catalog prices with pi-ai's calculateCost
          // (idempotent for real providers, which already do this internally).
          const cost = calculateCost(model, usage);
          yield {
            type: "usage",
            inputTokens: usage.input,
            outputTokens: usage.output,
            costUsd: cost.total,
          };
          yield { type: "done" };
          return;
        } else if (event.type === "error") {
          throw providerErrorFromFailure(event.error);
        }
      }
    },
  };
}
