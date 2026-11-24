import { generateKeyPairSync, sign } from "node:crypto";
import https from "node:https";
import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  ModelCredential,
  ModelGateway,
  ModelTarget,
  ProviderStreamEvent,
  UrlGuard,
} from "@middleware/core";
import { ForbiddenUrlError, ProviderError } from "@middleware/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPiModelGateway } from "./pi-model-gateway.ts";
import { createSafeFetch } from "./safe-fetch.ts";

/**
 * The faux provider is registered under the pi-ai id "openai", so every call
 * exercises the gateway's real registry path. Nothing here touches the
 * network or a real key.
 */
const fauxModelDefinitions = [
  {
    id: "faux-1",
    name: "Faux One",
    reasoning: true,
    // Catalog prices in USD per million tokens; pi-ai's calculateCost reads
    // them for the per-message cost (the faux stream itself reports 0).
    cost: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0 },
  },
];

const credential = { apiKey: "sk-faux-key" };

const fauxDescriptor = {
  id: "faux-1",
  name: "Faux One",
  providerId: "openai",
  contextWindow: 128000,
  maxTokens: 16384,
  reasoning: true,
};

function createFauxGateway(): {
  gateway: ModelGateway;
  faux: FauxProviderHandle;
} {
  const faux = fauxProvider({
    provider: "openai",
    models: fauxModelDefinitions,
  });
  const gateway = createPiModelGateway({
    listProviders: () => [faux.provider],
  });
  return { gateway, faux };
}

function fauxTarget(modelId = "faux-1"): ModelTarget {
  return { providerId: "openai", modelId, credential };
}

async function collectEvents(
  gateway: ModelGateway,
  target: ModelTarget,
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of gateway.stream(target)) {
    events.push(event);
  }
  return events;
}

function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/** Drains the stream and returns the ProviderError it must fail with. */
async function streamFailure(
  gateway: ModelGateway,
  target: ModelTarget,
): Promise<ProviderError> {
  try {
    await collectEvents(gateway, target);
  } catch (error) {
    if (isProviderError(error)) {
      return error;
    }
    throw new Error(`expected a ProviderError, got: ${String(error)}`);
  }
  throw new Error("expected the stream to fail, but it completed");
}

function eventsOfType<TType extends ProviderStreamEvent["type"]>(
  events: readonly ProviderStreamEvent[],
  type: TType,
): Array<Extract<ProviderStreamEvent, { type: TType }>> {
  return events.filter(
    (event): event is Extract<ProviderStreamEvent, { type: TType }> =>
      event.type === type,
  );
}

describe("createPiModelGateway", () => {
  describe("listModels", () => {
    it("returns the provider catalog with the port's descriptor shape", async () => {
      const { gateway } = createFauxGateway();
      const models = await gateway.listModels({
        providerId: "openai",
        credential,
      });
      expect(models).toEqual([fauxDescriptor]);
    });

    it("returns an empty list for a compatible credential without a baseUrl", async () => {
      const { gateway } = createFauxGateway();
      // No baseUrl means nothing to synthesize and nothing to discover.
      const models = await gateway.listModels({
        providerId: "openai-compatible",
        credential,
      });
      expect(models).toEqual([]);
    });
  });

  describe("findModel", () => {
    it("returns the catalog descriptor without a credential or network", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai", "faux-1")).toEqual(fauxDescriptor);
    });

    it("returns null for an unknown model id", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai", "no-such-model")).toBeNull();
    });

    it("synthesizes a descriptor for any compatible model id", () => {
      const { gateway } = createFauxGateway();
      expect(gateway.findModel("openai-compatible", "whatever-v1")).toEqual({
        id: "whatever-v1",
        name: "whatever-v1",
        providerId: "openai-compatible",
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: false,
      });
    });
  });

  describe("stream", () => {
    it("yields text deltas and ends with usage and done", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(
        eventsOfType(events, "text")
          .map((event) => event.text)
          .join(""),
      ).toBe("hola mundo");
      expect(events.at(-1)?.type).toBe("done");
      expect(events.at(-2)?.type).toBe("usage");
    });

    it("yields thinking deltas as thinking events", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("pensando..."), fauxText("listo")]),
      ]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(
        eventsOfType(events, "thinking")
          .map((event) => event.text)
          .join(""),
      ).toBe("pensando...");
      expect(
        eventsOfType(events, "text")
          .map((event) => event.text)
          .join(""),
      ).toBe("listo");
    });

    it("still completes with usage and done when the response is a tool call", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("search", { query: "middleware" })]),
      ]);
      const events = await collectEvents(gateway, fauxTarget());
      expect(eventsOfType(events, "text")).toEqual([]);
      expect(events.at(-1)?.type).toBe("done");
      expect(events.at(-2)?.type).toBe("usage");
    });

    it("carries pi-ai's per-message cost in the usage event", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([fauxAssistantMessage([fauxText("hola mundo")])]);
      const events = await collectEvents(gateway, fauxTarget());
      const usage = eventsOfType(events, "usage")[0];
      if (usage === undefined) {
        throw new Error("expected a usage event before done");
      }
      // The port carries no transcript yet, so input is 0; the output is the
      // faux token estimate and the cost is calculateCost at the catalog
      // price (5 USD per million output tokens).
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(usage.costUsd).toBe((5 / 1_000_000) * usage.outputTokens);
    });
  });

  describe("§10 provider error mapping", () => {
    it.each([
      ["401: Incorrect API key provided", "invalid_api_key"],
      [
        "429: You exceeded your current quota, please check your plan and billing details",
        "insufficient_quota",
      ],
      ["429: Rate limit reached for requests", "rate_limited"],
      [
        "404: The model 'faux-x' does not exist or you do not have access to it",
        "model_not_found",
      ],
      [
        "400: This model's maximum context length is 4096 tokens, however you requested 5000 tokens",
        "context_too_long",
      ],
      ["Request timed out after 60000 ms", "provider_timeout"],
      [
        "503: The service is currently overloaded, please try again later",
        "provider_unavailable",
      ],
      [
        "The response was filtered by the content management policy",
        "content_filtered",
      ],
      ["Something completely unexpected happened", "unknown"],
    ])("maps %s to %s", async (errorMessage, code) => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], { stopReason: "error", errorMessage }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.code).toBe(code);
    });

    it("keeps the provider's raw text out of the error (S2)", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: "401: Incorrect API key provided sk-live-123",
        }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.code).toBe("invalid_api_key");
      // Only the code travels: no provider text, no key.
      expect(error.message).toBe("invalid_api_key");
      expect(String(error)).not.toContain("sk-live-123");
    });

    it("fails with model_not_found when the model is not in the catalog", async () => {
      const { gateway } = createFauxGateway();
      const error = await streamFailure(gateway, fauxTarget("no-such-model"));
      expect(error.code).toBe("model_not_found");
    });

    it("fails with model_not_found for a provider id without a pi-ai provider", async () => {
      const { gateway } = createFauxGateway();
      const error = await streamFailure(gateway, {
        providerId: "openai-compatible",
        modelId: "faux-1",
        credential,
      });
      expect(error.code).toBe("model_not_found");
    });

    it("never echoes the credential key in the error message", async () => {
      const { gateway, faux } = createFauxGateway();
      faux.setResponses([
        fauxAssistantMessage([], {
          stopReason: "error",
          errorMessage: `Request rejected for key ${credential.apiKey}`,
        }),
      ]);
      const error = await streamFailure(gateway, fauxTarget());
      expect(error.message).not.toContain(credential.apiKey);
    });
  });
});

/* ------------------------------------------------------------------ *
 * Fixture: the same in-test self-signed certificate pattern as
 * safe-fetch.test.ts, for a fake OpenAI-compatible endpoint serving
 * `/v1/models` and `/v1/chat/completions` over TLS.
 * ------------------------------------------------------------------ */

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

function derSequence(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function derOid(dotted: string): Buffer {
  const parts = dotted.split(".").map((part) => Number.parseInt(part, 10));
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined || first < 0 || second < 0) {
    throw new Error(`unsupported OID: ${dotted}`);
  }
  const bytes = [first * 40 + second];
  for (const part of parts.slice(2)) {
    const groups: number[] = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) {
      groups.unshift(0x80 | (value & 0x7f));
      value >>= 7;
    }
    bytes.push(...groups);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function derName(cn: string): Buffer {
  const attr = derSequence(derOid("2.5.4.3"), tlv(0x0c, Buffer.from(cn)));
  return derSequence(tlv(0x31, attr));
}

function derValidity(): Buffer {
  const notBefore = tlv(0x17, Buffer.from("260101000000Z"));
  const notAfter = tlv(0x17, Buffer.from("361231235959Z"));
  return derSequence(notBefore, notAfter);
}

function derExtensions(dnsName: string): Buffer {
  const generalNames = derSequence(tlv(0x82, Buffer.from(dnsName)));
  const extension = derSequence(derOid("2.5.29.17"), tlv(0x04, generalNames));
  return tlv(0xa3, derSequence(extension));
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const sha256Rsa = derSequence(
  derOid("1.2.840.113549.1.1.11"),
  tlv(0x05, Buffer.alloc(0)),
);

const spki = Buffer.from(publicKey.export({ type: "spki", format: "der" }));

const tbs = derSequence(
  tlv(0xa0, Buffer.from([0x02, 0x01, 0x02])), // [0] EXPLICIT v3
  Buffer.from([0x02, 0x01, 0x01]), // serialNumber 1
  sha256Rsa,
  derName("example.test"), // issuer (self-signed)
  derValidity(),
  derName("example.test"), // subject
  spki,
  derExtensions("example.test"),
);

const certDer = derSequence(
  tbs,
  sha256Rsa,
  tlv(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, privateKey)])),
);

function toPem(der: Buffer, label: string): string {
  const base64 = der.toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

const compatKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const compatCertPem = toPem(certDer, "CERTIFICATE");

interface SeenCompatRequest {
  method: string | undefined;
  path: string | undefined;
  authorization: string | undefined;
  body: string;
}

const compatSeen: SeenCompatRequest[] = [];

/** Per-test behaviour of the fake endpoint; defaults to a working catalog. */
let modelsReply: { status: number; body: string } = {
  status: 200,
  body: JSON.stringify({ data: [{ id: "compat-mini" }, { id: "compat-max" }] }),
};
const completionsReplyDefaultBody = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"compat-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"hola"}}]}',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"compat-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "data: [DONE]",
].join("\n\n");
let completionsReply: { status: number; body: string } = {
  status: 200,
  body: completionsReplyDefaultBody,
};

let compatServer: https.Server;
let compatPort = 0;
const compatBaseUrl = () => `https://example.test:${compatPort}/v1`;

const compatGuard: UrlGuard = {
  assertAllowed: async (rawUrl) => ({
    url: new URL(rawUrl),
    addresses: ["127.0.0.1"],
  }),
};

const refusingCompatGuard: UrlGuard = {
  assertAllowed: async () => {
    throw new ForbiddenUrlError("private");
  },
};

function createCompatGateway(urlGuard: UrlGuard): ModelGateway {
  return createPiModelGateway({
    urlGuard,
    safeFetch: createSafeFetch({
      guard: urlGuard,
      allowUnauthorizedTls: true,
    }),
  });
}

// Built per call: the port is only known once the test server is listening.
const compatCredential = (): ModelCredential => ({
  apiKey: "sk-compat-key",
  baseUrl: compatBaseUrl(),
});

function compatTarget(modelId = "compat-mini"): ModelTarget {
  return {
    providerId: "openai-compatible",
    modelId,
    credential: compatCredential(),
  };
}

const compatRequests = () => compatSeen.length;

beforeAll(async () => {
  compatServer = https.createServer(
    { key: compatKeyPem, cert: compatCertPem },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        compatSeen.push({
          method: req.method,
          path: req.url,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (req.url?.endsWith("/models")) {
          res.writeHead(modelsReply.status, {
            "content-type": "application/json",
          });
          res.end(modelsReply.body);
          return;
        }
        if (req.url?.endsWith("/chat/completions")) {
          if (completionsReply.status === 200) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(completionsReply.body);
          } else {
            res.writeHead(completionsReply.status, {
              "content-type": "application/json",
            });
            res.end(completionsReply.body);
          }
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
      });
    },
  );
  await new Promise<void>((resolve, reject) => {
    compatServer.once("error", reject);
    compatServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = compatServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not report a port");
  }
  compatPort = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => compatServer.close(() => resolve()));
});

describe("createPiModelGateway for openai-compatible", () => {
  it("discovers the endpoint's models through the pinned-address client", async () => {
    const gateway = createCompatGateway(compatGuard);
    const before = compatRequests();
    const models = await gateway.listModels({
      providerId: "openai-compatible",
      credential: compatCredential(),
    });
    expect(models).toEqual([
      {
        id: "compat-mini",
        name: "compat-mini",
        providerId: "openai-compatible",
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: false,
      },
      {
        id: "compat-max",
        name: "compat-max",
        providerId: "openai-compatible",
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoning: false,
      },
    ]);
    const request = compatSeen[before];
    expect(request?.path).toBe("/v1/models");
    expect(request?.authorization).toBe(`Bearer ${compatCredential().apiKey}`);
  });

  it("returns an empty catalog on a non-2xx discovery reply", async () => {
    const gateway = createCompatGateway(compatGuard);
    modelsReply = { status: 401, body: JSON.stringify({ error: {} }) };
    try {
      await expect(
        gateway.listModels({
          providerId: "openai-compatible",
          credential: compatCredential(),
        }),
      ).resolves.toEqual([]);
    } finally {
      modelsReply = {
        status: 200,
        body: JSON.stringify({ data: [{ id: "compat-mini" }] }),
      };
    }
  });

  it("returns an empty catalog when the body parses but lists no model", async () => {
    const gateway = createCompatGateway(compatGuard);
    modelsReply = { status: 200, body: JSON.stringify({ data: [] }) };
    try {
      await expect(
        gateway.listModels({
          providerId: "openai-compatible",
          credential: compatCredential(),
        }),
      ).resolves.toEqual([]);
    } finally {
      modelsReply = {
        status: 200,
        body: JSON.stringify({ data: [{ id: "compat-mini" }] }),
      };
    }
  });

  it("returns an empty catalog on a malformed discovery body", async () => {
    const gateway = createCompatGateway(compatGuard);
    modelsReply = { status: 200, body: "{" };
    try {
      await expect(
        gateway.listModels({
          providerId: "openai-compatible",
          credential: compatCredential(),
        }),
      ).resolves.toEqual([]);
    } finally {
      modelsReply = {
        status: 200,
        body: JSON.stringify({ data: [{ id: "compat-mini" }] }),
      };
    }
  });

  it("streams text through the pinned-address client and the server sees it", async () => {
    const gateway = createCompatGateway(compatGuard);
    const before = compatRequests();
    const events = await collectEvents(gateway, compatTarget());
    expect(
      eventsOfType(events, "text")
        .map((event) => event.text)
        .join(""),
    ).toBe("hola");
    expect(events.at(-1)?.type).toBe("done");
    const request = compatSeen[before];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v1/chat/completions");
    expect(request?.authorization).toBe(`Bearer ${compatCredential().apiKey}`);
    expect(request?.body).toContain("compat-mini");
  });

  it("connects nowhere when the guard refuses the base URL", async () => {
    const gateway = createCompatGateway(refusingCompatGuard);
    const before = compatRequests();
    await expect(
      gateway.listModels({
        providerId: "openai-compatible",
        credential: compatCredential(),
      }),
    ).resolves.toEqual([]);
    await expect(collectEvents(gateway, compatTarget())).rejects.toBeInstanceOf(
      ForbiddenUrlError,
    );
    expect(compatRequests()).toBe(before);
  });

  it("maps a 401 from the endpoint to invalid_api_key", async () => {
    const gateway = createCompatGateway(compatGuard);
    completionsReply = {
      status: 401,
      body: JSON.stringify({
        error: {
          message: "Incorrect API key provided: sk-wrong. Update your key.",
          type: "invalid_request_error",
        },
      }),
    };
    try {
      const error = await streamFailure(gateway, compatTarget());
      expect(error.code).toBe("invalid_api_key");
    } finally {
      completionsReply = { status: 200, body: completionsReplyDefaultBody };
    }
  });
});
