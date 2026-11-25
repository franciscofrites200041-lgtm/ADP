import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  calculateCost,
  createModels,
  type Message,
  type Provider as PiProvider,
  type TextContent,
  type Usage,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { agentParamsSchema } from "@middleware/contracts";
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeTurn,
  RuntimeMessage,
  UrlGuard,
} from "@middleware/core";
import { ForbiddenUrlError, ProviderError } from "@middleware/core";
import { InvariantError } from "./errors.ts";

import {
  CLOSED_AUTH_CONTEXT,
  createCompatibleProvider,
  mapProviderErrorCode,
  PI_PROVIDER_IDS,
  type PiChatModel,
  singleCredentialStore,
  synthesizeCompatibleModel,
} from "./pi-provider-machinery.ts";

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
    throw new InvariantError(
      "turn_needs_message",
      "A turn needs at least one message",
    );
  }
  // The boundary check for the version's params (S3): a row that does not
  // honour the contract is a broken invariant — it fails the turn loudly
  // instead of running on whatever the provider does with a rogue value.
  let modelParams: AgentRuntimeTurn["params"];
  if (input.params === undefined) {
    modelParams = undefined;
  } else {
    const parsed = agentParamsSchema.safeParse(input.params);
    if (!parsed.success) {
      throw new InvariantError(
        "turn_params_invalid",
        "The turn's params do not honour the contract",
      );
    }
    modelParams = parsed.data;
  }
  const last = input.messages.at(-1);
  if (last === undefined || last.role === "assistant") {
    // A caller bug in the engine's loop, never a user outcome (§10).
    throw new InvariantError(
      "turn_prompt_invalid",
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
      // One provider per turn: built fresh, its catalog is empty (models are
      // synthesized per request) and it holds no mutable state.
      provider = createCompatibleProvider(baseUrl);
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
  // always stream through the pinned-address client (§8). The version's own
  // params (S3) ride the stream options: they are how the agent version's
  // temperature and token cap reach the provider request.
  const params = modelParams;
  const safeFetch = deps.safeFetch;
  const streamFn: StreamFn = (requestModel, context, options) =>
    models.streamSimple(requestModel, context, {
      ...options,
      ...(params?.temperature === undefined
        ? {}
        : { temperature: params.temperature }),
      ...(params?.maxTokens === undefined
        ? {}
        : { maxTokens: params.maxTokens }),
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
