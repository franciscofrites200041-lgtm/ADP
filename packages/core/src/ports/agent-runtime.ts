import type { AgentParams, ProviderErrorCode } from "@middleware/contracts";

import type { ModelTarget } from "./model-gateway.ts";

/**
 * Our own neutral transcript message (D2): the engine stores and replays
 * these, and no pi-ai type crosses into core. `text` carries the whole message
 * for `user`/`assistant`; `tool_result` also carries the call it answers, so
 * WP-40 can replay tool turns once tools exist.
 */
export type RuntimeMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | {
      role: "tool_result";
      text: string;
      toolCallId: string;
      toolName: string;
    };

/** Token accounting of one turn, in our own units (never pi-ai's). */
export type RuntimeUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/**
 * One agent turn: the model to run, an optional prompt, and the transcript so
 * far. The runtime is single-turn and stateless: history comes in `messages`
 * and nothing is kept between calls. Retry, timeouts, checkpoint and limits
 * belong to the run engine, not here.
 */
export type AgentRuntimeTurn = {
  model: ModelTarget;
  systemPrompt?: string | undefined;
  messages: readonly RuntimeMessage[];
  /**
   * The agent version's own model params (S3): temperature and whatever else
   * the contract allows. The runtime validates the shape at this boundary
   * and passes it into the provider request; an invalid shape fails the
   * turn loudly, never as silent defaults.
   */
  params?: AgentParams;
};

/**
 * What a turn streams, in order: text and thinking deltas, one `usage`
 * summary, and a final `done` (with the turn's output and usage) — or one
 * terminal `error`. The provider's raw failure text never appears in an
 * event: only the catalog code crosses this boundary (S2, §8).
 */
export type AgentRuntimeEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { type: "done"; output: string; usage: RuntimeUsage }
  | { type: "error"; code: ProviderErrorCode; message: string };

/**
 * The agent loop, behind a port (D2): core drives turns through this shape
 * and the adapter owns the Pi agent library. A turn ends at the first `done`
 * or `error` event; abandoning the iterable aborts the underlying run.
 */
export type AgentRuntime = {
  streamTurn(input: AgentRuntimeTurn): AsyncIterable<AgentRuntimeEvent>;
};
