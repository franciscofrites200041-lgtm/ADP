import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  type Api,
  type ApiKeyCredential,
  type AssistantMessage,
  type AuthContext,
  type CredentialStore,
  calculateCost,
  createModels,
  createProvider,
  type Message,
  type Model,
  type Provider as PiProvider,
  type ProviderAuth,
  type TextContent,
  type Usage,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ProviderErrorCode } from "@middleware/contracts";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeTurn,
  RuntimeMessage,
  UrlGuard,
} from "@middleware/core";
import {
  DomainError,
  ForbiddenUrlError,
  ProviderError,
} from "@middleware/core";

/**
 * Our provider ids → pi-ai provider ids, mirroring the model gateway: the
 * compiler forces a line here for every new id (a new contract id stops this
 * file typechecking until the map has it).
 *
 * "openai-compatible" resolves to a provider synthesized from the credential's
 * `baseUrl`, built only after the injected `UrlGuard` approves the URL and
 * contacted only through the injected safe fetch (§8). Both pieces are the
 * same guard and client the container built for the gateway.
 */
const PI_PROVIDER_IDS = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  xai: "xai",
  openrouter: "openrouter",
  "openai-compatible": "openai-compatible",
} as const;

type PiChatModel = Model<Api>;

/**
 * pi-ai's default auth context reads `process.env` and the filesystem for
 * ambient credentials, which S3 forbids. Every `Models` built here gets this
 * closed context, so auth can only come from the credential of the turn.
 */
const CLOSED_AUTH_CONTEXT: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

/** Catalog defaults for compatible endpoints, which advertise no limits. */
const COMPAT_CONTEXT_WINDOW = 128_000;
const COMPAT_MAX_TOKENS = 16_384;

/**
 * Auth for the synthesized compatible provider: it resolves only from the
 * per-turn credential store, never from the environment (S3).
 */
const COMPAT_AUTH: ProviderAuth = {
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
 * The per-turn store is an in-call read-only view (S3); a write to it is a
 * programming error, never a user-facing outcome.
 */
class ReadOnlyCredentialStoreError extends DomainError {
  constructor() {
    super("unknown", "The per-turn credential store is read-only");
  }
}

/** A store that holds exactly one credential, alive only for one turn (S3). */
function singleCredentialStore(
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
      throw new ReadOnlyCredentialStoreError();
    },
    async delete() {
      throw new ReadOnlyCredentialStoreError();
    },
  };
}

/** The synthesized chat model: one per requested id, bound to the base URL. */
function synthesizeCompatibleModel(
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
 * The §10 codes the runtime produces; the rest of the catalog belongs to the
 * run engine. Mirrors the gateway's table: first match wins, so a message is
 * checked from most to least specific (a 429 that says "quota" must beat the
 * generic rate-limit line).
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

/** Classifies a pi-agent-core failure text into the §10 catalog (§10). */
function mapProviderErrorCode(failure: string): ProviderErrorCode {
  for (const [pattern, code] of FAILURE_PATTERNS) {
    if (pattern.test(failure)) {
      return code;
    }
  }
  return "unknown";
}

/**
 * Usage recorded for replayed assistant history: never sent as new tokens,
 * just enough of the shape pi-ai requires.
 */
const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** A history assistant message rebuilt as a complete pi-ai message. */
function replayedAssistantMessage(
  text: string,
  model: PiChatModel,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Our neutral transcript message → the pi-ai message the loop replays. */
function toPiMessage(message: RuntimeMessage, model: PiChatModel): Message {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.text, timestamp: Date.now() };
    case "assistant":
      return replayedAssistantMessage(message.text, model);
    case "tool_result":
      // WP-40 replays tool turns through this branch; text-only for now.
      return {
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: [{ type: "text", text: message.text }],
        isError: false,
        timestamp: Date.now(),
      };
  }
}

/**
 * Buffers agent events between the agent's push-based subscription and the
 * port's pull-based `AsyncIterable`, so the consumer sets the pace.
 */
class RuntimeEventQueue {
  private items: AgentRuntimeEvent[] = [];
  private waiter: (() => void) | undefined;
  private closed = false;

  /** Set once a terminal (`done`/`error`) event has been queued. */
  terminalSeen = false;

  push(event: AgentRuntimeEvent): void {
    if (this.closed) return;
    this.items.push(event);
    const wake = this.waiter;
    this.waiter = undefined;
    wake?.();
  }

  close(): void {
    this.closed = true;
    const wake = this.waiter;
    this.waiter = undefined;
    wake?.();
  }

  async *drain(): AsyncGenerator<AgentRuntimeEvent> {
    while (true) {
      while (this.items.length > 0) {
        const event = this.items.shift();
        if (event !== undefined) yield event;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

/** Everything `createPiAgentRuntime` closes over. */
type RuntimeDeps = {
  listProviders: () => readonly PiProvider[];
  /** Approves a compatible credential's `baseUrl` before any connection. */
  urlGuard: UrlGuard | undefined;
  /** The pinned-address client every compatible request must go through. */
  safeFetch: typeof fetch | undefined;
};

/** Resolved model, transcript split, and the stream function bound to them. */
type PreparedTurn = {
  model: PiChatModel;
  streamFn: StreamFn;
  /** Every message but the last, replayed as the conversation so far. */
  history: Message[];
  /** The last message, the one that provokes this turn's response. */
  prompt: Message;
};

async function prepareTurn(
  input: AgentRuntimeTurn,
  deps: RuntimeDeps,
): Promise<PreparedTurn> {
  if (input.messages.length === 0) {
    throw new TypeError("A turn needs at least one message");
  }
  const last = input.messages.at(-1);
  if (last === undefined || last.role === "assistant") {
    throw new TypeError(
      "The last message of a turn must be a user or tool_result message",
    );
  }
  const providerId = PI_PROVIDER_IDS[input.model.providerId];
  const credential = input.model.credential;

  let provider: PiProvider | undefined;
  let model: PiChatModel | undefined;
  if (providerId === "openai-compatible") {
    // No base URL, no guard or no safe fetch: nothing to synthesize. The
    // guard throws `ForbiddenUrlError` before any connection is possible.
    const baseUrl = credential.baseUrl;
    if (deps.urlGuard === undefined || deps.safeFetch === undefined) {
      provider = undefined;
    } else if (baseUrl === undefined) {
      provider = undefined;
    } else {
      await deps.urlGuard.assertAllowed(baseUrl);
      // One provider per base URL: its catalog is empty (models are
      // synthesized per request), so it is immutable and safe to cache.
      provider = createProvider({
        id: "openai-compatible",
        name: "Compatible with OpenAI",
        baseUrl,
        auth: COMPAT_AUTH,
        models: [],
        api: openAICompletionsApi(),
      });
      model = synthesizeCompatibleModel(input.model.modelId, baseUrl);
    }
  } else {
    provider =
      deps.listProviders().find((candidate) => candidate.id === providerId) ??
      undefined;
  }
  if (provider === undefined) {
    throw new ProviderError("model_not_found");
  }

  // Fresh `Models` per turn with only that turn's credential: one execution,
  // never shared, and the key is passed explicitly below, never via env (S3).
  const models = createModels({
    credentials: singleCredentialStore(provider.id, credential.apiKey),
    authContext: CLOSED_AUTH_CONTEXT,
  });
  models.setProvider(provider);
  if (model === undefined) {
    model = models.getModel(provider.id, input.model.modelId);
  }
  if (model === undefined) {
    throw new ProviderError("model_not_found");
  }
  const resolvedModel: PiChatModel = model;

  // The key goes with every request explicitly, and compatible endpoints
  // always stream through the pinned-address client (§8).
  const safeFetch = deps.safeFetch;
  const streamFn: StreamFn = (requestModel, context, options) =>
    models.streamSimple(requestModel, context, {
      ...options,
      apiKey: credential.apiKey,
      ...(safeFetch === undefined ? {} : { fetch: safeFetch }),
    });

  const history = input.messages
    .slice(0, -1)
    .map((message) => toPiMessage(message, resolvedModel));
  const promptMessage = toPiMessage(last, resolvedModel);

  return { model: resolvedModel, streamFn, history, prompt: promptMessage };
}

/**
 * The pi-agent-core adapter of the `AgentRuntime` port (D2): it owns every
 * touchpoint with the agent library and speaks only the neutral event union.
 * Single-turn and stateless: a fresh `Agent` per call, no tool registry
 * (WP-40 adds tools), no retry, no checkpoint — those belong to the engine.
 */
export function createPiAgentRuntime(
  options: {
    listProviders?: () => readonly PiProvider[];
    urlGuard?: UrlGuard;
    safeFetch?: typeof fetch;
  } = {},
): AgentRuntime {
  const deps: RuntimeDeps = {
    listProviders: options.listProviders ?? builtinProviders,
    urlGuard: options.urlGuard,
    safeFetch: options.safeFetch,
  };

  const toErrorEvent = (error: unknown): AgentRuntimeEvent => {
    if (error instanceof ProviderError) {
      // Only the code crosses this boundary; the provider's own text never
      // does, so no secret can leak through an event (S2, §8).
      return { type: "error", code: error.code, message: error.code };
    }
    if (error instanceof ForbiddenUrlError) {
      // A refused base URL: the provider can never be reached through it.
      return {
        type: "error",
        code: "provider_unavailable",
        message: "provider_unavailable",
      };
    }
    return { type: "error", code: "unknown", message: "unknown" };
  };

  return {
    async *streamTurn(input: AgentRuntimeTurn) {
      const queue = new RuntimeEventQueue();
      let agent: Agent | undefined;
      let unsubscribe: (() => void) | undefined;
      let run: Promise<void> | undefined;
      try {
        const prepared = await prepareTurn(input, deps);
        const model = prepared.model;
        agent = new Agent({
          initialState: {
            model,
            ...(input.systemPrompt === undefined
              ? {}
              : { systemPrompt: input.systemPrompt }),
            messages: prepared.history,
          },
          streamFn: prepared.streamFn,
        });
        unsubscribe = agent.subscribe((event) => {
          if (event.type === "message_update") {
            const delta = event.assistantMessageEvent;
            if (delta.type === "text_delta") {
              queue.push({ type: "text", text: delta.delta });
            } else if (delta.type === "thinking_delta") {
              queue.push({ type: "thinking", text: delta.delta });
            }
            return;
          }
          if (event.type !== "message_end") return;
          const message = event.message;
          if (message.role !== "assistant") return;
          if (
            message.stopReason === "error" ||
            message.stopReason === "aborted"
          ) {
            queue.terminalSeen = true;
            // Only the code crosses this boundary; the provider's raw text
            // never does, so no secret can leak through an event (S2, §8).
            const code = mapProviderErrorCode(message.errorMessage ?? "");
            queue.push({ type: "error", code, message: code });
            return;
          }
          // The turn's final message: report usage, then close with the
          // output (its text blocks; thinking was streamed as it happened).
          const usage = message.usage;
          // The faux provider reports a zero cost, so the per-message cost is
          // always computed from catalog prices with pi-ai's calculateCost
          // (idempotent for real providers, which already do this internally).
          const costUsd = calculateCost(model, usage).total;
          queue.push({
            type: "usage",
            inputTokens: usage.input,
            outputTokens: usage.output,
            costUsd,
          });
          queue.terminalSeen = true;
          queue.push({
            type: "done",
            output: message.content
              .filter((block): block is TextContent => block.type === "text")
              .map((block) => block.text)
              .join(""),
            usage: {
              inputTokens: usage.input,
              outputTokens: usage.output,
              costUsd,
            },
          });
        });
        // Never rejects: the agent turns failures into a final failed message.
        run = agent.prompt(prepared.prompt);
        run.then(
          () => queue.close(),
          () => queue.close(),
        );
        for await (const event of queue.drain()) {
          yield event;
          if (event.type === "done" || event.type === "error") return;
        }
      } catch (error) {
        yield toErrorEvent(error);
      } finally {
        // A consumer that walks away mid-turn must not leave the provider
        // call running: abort, then let the agent settle its failed run.
        if (agent !== undefined && !queue.terminalSeen) agent.abort();
        unsubscribe?.();
        queue.close();
        if (run !== undefined) await run;
      }
    },
  };
}
