import {
  type AssistantMessage,
  calculateCost,
  createModels,
  type MutableModels,
  type Provider as PiProvider,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ModelDescriptor, ProviderErrorCode } from "@middleware/contracts";
import type {
  ModelCredential,
  ModelGateway,
  ModelTarget,
  ProviderStreamEvent,
  UrlGuard,
} from "@middleware/core";
import { ProviderError } from "@middleware/core";
import { z } from "zod";

import {
  CLOSED_AUTH_CONTEXT,
  COMPAT_CONTEXT_WINDOW,
  COMPAT_MAX_TOKENS,
  createCompatibleProvider,
  mapProviderErrorCode,
  type OurProviderId,
  PI_PROVIDER_IDS,
  type PiChatModel,
  singleCredentialStore,
  synthesizeCompatibleModel,
} from "./pi-provider-machinery.ts";

/**
 * Only the code crosses this boundary; the Spanish text lives in the messages
 * file of the layer that renders it, and never the provider's own message, so
 * no secret can leak through an error detail (S2, WP-33).
 */
function providerError(code: ProviderErrorCode): ProviderError {
  return new ProviderError(code);
}

function providerErrorFromFailure(failure: AssistantMessage): ProviderError {
  const message =
    failure.errorMessage ?? "The provider request failed without a message";
  return providerError(mapProviderErrorCode(message));
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
 * An OpenAI-compatible `/models` body, at the boundary (AGENTS: validate with
 * Zod at every edge). Only the ids matter; anything else is dropped, and any
 * malformation, including one bad entry, empties the catalog like the hand
 * written checks did.
 */
const compatibleModelsBody = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});

/** The ids of an OpenAI-compatible `/models` body, or [] when malformed. */
function extractCompatibleModelIds(body: unknown): string[] {
  const parsed = compatibleModelsBody.safeParse(body);
  return parsed.success ? parsed.data.data.map((model) => model.id) : [];
}

/**
 * The pi-ai adapter of the `ModelGateway` port (D2): it owns every pi-ai
 * touchpoint, builds a fresh `Models` per call that holds only that call's
 * credential, and passes the api key explicitly so nothing is ever read from
 * the environment (S3).
 */
export function createPiModelGateway(
  options: {
    listProviders?: () => readonly PiProvider[];
    /** Approves a compatible credential's `baseUrl` before any connection. */
    urlGuard?: UrlGuard;
    /** The pinned-address client every compatible request must go through. */
    safeFetch?: typeof fetch;
  } = {},
): ModelGateway {
  // Provider objects are pi-ai's immutable catalogs, safe to share; only the
  // Models collection and its credential store are per call.
  const piProviders = options.listProviders
    ? options.listProviders()
    : builtinProviders();
  const { urlGuard, safeFetch } = options;

  // One provider per base URL: its catalog is empty (models are synthesized
  // per request), so it is immutable and safe to reuse across calls.
  const compatibleProviders = new Map<string, PiProvider>();

  const compatibleProviderFor = (baseUrl: string): PiProvider => {
    const cached = compatibleProviders.get(baseUrl);
    if (cached !== undefined) return cached;
    const provider = createCompatibleProvider(baseUrl);
    compatibleProviders.set(baseUrl, provider);
    return provider;
  };

  const isCompatible = (providerId: OurProviderId): boolean =>
    PI_PROVIDER_IDS[providerId] === "openai-compatible";

  /** The credential's approved base URL, or undefined outside the funnel. */
  const compatibleBaseUrlOf = (
    providerId: OurProviderId,
    credential: ModelCredential | undefined,
  ): string | undefined => {
    if (!isCompatible(providerId)) return undefined;
    if (urlGuard === undefined || safeFetch === undefined) return undefined;
    return credential?.baseUrl;
  };

  const piProviderFor = async (
    providerId: OurProviderId,
    credential?: ModelCredential,
  ): Promise<PiProvider | undefined> => {
    if (isCompatible(providerId)) {
      // No base URL, no guard or no safe fetch: nothing to synthesize, the
      // pre-WP-14 behaviour. The guard throws `ForbiddenUrlError` before any
      // connection is possible.
      if (urlGuard === undefined || safeFetch === undefined) return undefined;
      const baseUrl = credential?.baseUrl;
      if (baseUrl === undefined) return undefined;
      await urlGuard.assertAllowed(baseUrl);
      return compatibleProviderFor(baseUrl);
    }
    const piId = PI_PROVIDER_IDS[providerId];
    return piProviders.find((candidate) => candidate.id === piId);
  };

  /**
   * Discovery against the endpoint's own `/models` route, through the safe
   * fetch. A discovery failure (non-2xx, malformed body, refused URL) is an
   * empty catalog, never a throw: the credentials screen must stay usable.
   */
  const discoverCompatibleModels = async (
    credential: ModelCredential,
  ): Promise<ModelDescriptor[]> => {
    const baseUrl = compatibleBaseUrlOf("openai-compatible", credential);
    if (baseUrl === undefined || safeFetch === undefined) return [];
    try {
      const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      const response = await safeFetch(new URL("models", root), {
        headers: { authorization: `Bearer ${credential.apiKey}` },
      });
      if (!response.ok) return [];
      const body: unknown = await response.json();
      return extractCompatibleModelIds(body).map((id) => ({
        id,
        name: id,
        providerId: "openai-compatible" as const,
        contextWindow: COMPAT_CONTEXT_WINDOW,
        maxTokens: COMPAT_MAX_TOKENS,
        reasoning: false,
      }));
    } catch {
      // Refused URL, unreachable host or unreadable body: an empty catalog.
      return [];
    }
  };

  const freshModels = (
    provider: PiProvider,
    credential?: ModelCredential,
  ): MutableModels => {
    const models = createModels(
      credential === undefined
        ? { authContext: CLOSED_AUTH_CONTEXT }
        : {
            credentials: singleCredentialStore(provider.id, credential.apiKey),
            authContext: CLOSED_AUTH_CONTEXT,
          },
    );
    models.setProvider(provider);
    return models;
  };

  return {
    async listModels({ providerId, credential }) {
      if (isCompatible(providerId)) {
        return discoverCompatibleModels(credential);
      }
      const provider = await piProviderFor(providerId, credential);
      if (provider === undefined) {
        return [];
      }
      const models = freshModels(provider, credential);
      return models
        .getModels(provider.id)
        .map((model) => toModelDescriptor(providerId, model));
    },

    findModel(providerId, modelId) {
      // A compatible endpoint has no static catalog and `findModel` carries no
      // credential (and no network): any id the server may offer is accepted,
      // with the same defaults discovery reports.
      if (isCompatible(providerId)) {
        return modelId === ""
          ? null
          : {
              id: modelId,
              name: modelId,
              providerId,
              contextWindow: COMPAT_CONTEXT_WINDOW,
              maxTokens: COMPAT_MAX_TOKENS,
              reasoning: false,
            };
      }
      const provider = piProviders.find(
        (candidate) => candidate.id === PI_PROVIDER_IDS[providerId],
      );
      if (provider === undefined) {
        return null;
      }
      // Sync read of the static catalog: no credential, no network.
      const models = freshModels(provider);
      const model = models.getModel(provider.id, modelId);
      return model === undefined ? null : toModelDescriptor(providerId, model);
    },

    async *stream(target: ModelTarget): AsyncIterable<ProviderStreamEvent> {
      const provider = await piProviderFor(
        target.providerId,
        target.credential,
      );
      if (provider === undefined) {
        throw providerError("model_not_found");
      }
      const models = freshModels(provider, target.credential);
      const compatibleBaseUrl = compatibleBaseUrlOf(
        target.providerId,
        target.credential,
      );
      // A compatible endpoint advertises no catalog: the requested id is
      // synthesized into a model bound to the approved base URL.
      const model =
        compatibleBaseUrl === undefined
          ? models.getModel(provider.id, target.modelId)
          : synthesizeCompatibleModel(target.modelId, compatibleBaseUrl);
      if (model === undefined) {
        throw providerError("model_not_found");
      }
      // The port's target carries no transcript yet (WP-30 brings the
      // conversation); the key is passed explicitly, never via env (S3). The
      // compatible path always streams through the pinned-address client.
      const streamOptions: { apiKey: string; fetch?: typeof fetch } = {
        apiKey: target.credential.apiKey,
      };
      if (safeFetch !== undefined) streamOptions.fetch = safeFetch;
      const events = models.stream(model, { messages: [] }, streamOptions);
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
