import type {
  ModelDescriptor,
  ProviderErrorCode,
  ProviderId,
} from "@middleware/contracts";

/**
 * What a run needs from a model provider. The adapter owns pi-ai; the domain
 * only sees this port (D2, D14).
 */
export type ModelCredential = {
  /** Provider key, already decrypted, alive only for this run (S3). */
  apiKey: string;
  /** Only for `openai-compatible`. */
  baseUrl?: string | undefined;
};

export type ModelTarget = {
  providerId: ProviderId;
  modelId: string;
  /** Explicit key: the gateway never reads one from the environment (S3). */
  credential: ModelCredential;
};

export type ModelGateway = {
  /** Discovery for the credentials screen (WP-13). */
  listModels(input: {
    providerId: ProviderId;
    credential: ModelCredential;
  }): Promise<ModelDescriptor[]>;
  /** The catalog entry, without touching the network; `null` if unknown. */
  findModel(providerId: ProviderId, modelId: string): ModelDescriptor | null;
  /** Streams one completion; WP-30 turns these events into run events. */
  stream(target: ModelTarget): AsyncIterable<ProviderStreamEvent>;
};

/**
 * The smallest event shape the gateway emits. WP-30 translates these into the
 * §10 run events, so the port stays independent of the wire protocol.
 */
export type ProviderStreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { type: "done" };

/** A provider failure translated to the §10 catalog, safe to show. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, detail = code) {
    super(detail);
    this.name = "ProviderError";
    this.code = code;
  }
}
