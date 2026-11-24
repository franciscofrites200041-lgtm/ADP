import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { UrlGuard } from "@middleware/core";
import { ForbiddenUrlError } from "@middleware/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHttpCredentialProbe } from "./credential-probe.ts";

const apiKey = "sk-live-9f3k-never-logged";

/** A fake provider: the acceptance for WP-12 is written against one of these. */
let server: Server;
let baseUrl: string;
const seen: { authorization: string | undefined }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({ authorization: request.headers.authorization });
    const status = Number(request.url?.replace("/", "") ?? 500);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ echo: request.headers.authorization }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const probe = (path: string) =>
  createHttpCredentialProbe({ resolveEndpoint: () => `${baseUrl}/${path}` });

const target = { providerId: "openai" as const, apiKey, baseUrl: null };

describe("credential probe", () => {
  it("marks a working key valid", async () => {
    await expect(probe("200").probe(target)).resolves.toEqual({
      status: "valid",
    });
    expect(seen.at(-1)?.authorization).toBe(`Bearer ${apiKey}`);
  });

  it("marks a rejected key invalid with a reason", async () => {
    await expect(probe("401").probe(target)).resolves.toEqual({
      status: "invalid",
      code: "invalid_key",
    });
  });

  it("separates rate limiting from a broken key", async () => {
    await expect(probe("429").probe(target)).resolves.toEqual({
      status: "invalid",
      code: "rate_limited",
    });
  });

  it("calls anything else a provider error", async () => {
    await expect(probe("500").probe(target)).resolves.toEqual({
      status: "invalid",
      code: "provider_error",
    });
  });

  it("reports an unreachable provider without echoing the URL or the key", async () => {
    const unreachable = createHttpCredentialProbe({
      resolveEndpoint: () => "http://127.0.0.1:1/models",
    });

    const result = await unreachable.probe(target);

    expect(result).toEqual({
      status: "invalid",
      code: "provider_unreachable",
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });
});

const allowingGuard: UrlGuard = {
  assertAllowed: async (rawUrl) => ({
    url: new URL(rawUrl),
    addresses: ["93.184.216.34"],
  }),
};

const refusingGuard: UrlGuard = {
  assertAllowed: async () => {
    throw new ForbiddenUrlError("link_local");
  },
};

describe("credential probe for user-supplied hosts", () => {
  it("refuses to probe openai-compatible without the SSRF client (S5)", async () => {
    const probe = createHttpCredentialProbe({
      resolveEndpoint: () => {
        throw new Error("the probe must not resolve a user-supplied host");
      },
    });

    await expect(
      probe.probe({
        providerId: "openai-compatible",
        apiKey,
        baseUrl: "https://attacker.example/v1",
      }),
    ).resolves.toEqual({ status: "invalid", code: "unsupported_provider" });
  });

  it("probes a wired compatible endpoint through the guarded client", async () => {
    const seen: { url: string; authorization: string | undefined }[] = [];
    const probe = createHttpCredentialProbe({
      urlGuard: allowingGuard,
      safeFetch: async (input, init) => {
        seen.push({
          url: String(input),
          authorization:
            new Headers(init?.headers).get("authorization") ?? undefined,
        });
        return new Response("{}", { status: 200 });
      },
    });

    const result = await probe.probe({
      providerId: "openai-compatible",
      apiKey,
      baseUrl: "https://compatible.example/v1",
    });

    expect(result).toEqual({ status: "valid" });
    expect(seen).toEqual([
      {
        url: "https://compatible.example/v1/models",
        authorization: `Bearer ${apiKey}`,
      },
    ]);
  });

  it("refuses a base URL the guard rejects before connecting (S5)", async () => {
    const probe = createHttpCredentialProbe({
      urlGuard: refusingGuard,
      safeFetch: async () => {
        throw new Error("the probe must not contact a refused URL");
      },
    });

    await expect(
      probe.probe({
        providerId: "openai-compatible",
        apiKey,
        baseUrl: "https://169.254.169.254/v1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenUrlError);
  });

  it("reports an unreachable compatible endpoint without the key (S2)", async () => {
    const probe = createHttpCredentialProbe({
      urlGuard: allowingGuard,
      safeFetch: async () => {
        throw new Error("connection refused");
      },
    });

    const result = await probe.probe({
      providerId: "openai-compatible",
      apiKey,
      baseUrl: "https://compatible.example/v1",
    });

    expect(result).toEqual({ status: "invalid", code: "provider_unreachable" });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("maps a compatible endpoint's 401 to invalid_key", async () => {
    const probe = createHttpCredentialProbe({
      urlGuard: allowingGuard,
      safeFetch: async () => new Response("{}", { status: 401 }),
    });

    await expect(
      probe.probe({
        providerId: "openai-compatible",
        apiKey,
        baseUrl: "https://compatible.example/v1",
      }),
    ).resolves.toEqual({ status: "invalid", code: "invalid_key" });
  });
});
