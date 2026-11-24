import type { IncomingMessage } from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

import type { UrlGuard } from "@middleware/core";
import { ForbiddenUrlError } from "@middleware/core";

export interface CreateSafeFetchDeps {
  /** The guard decides what may be contacted and pins the addresses. */
  guard: UrlGuard;
  /**
   * Exists only so tests can talk to a local server with a self-signed
   * certificate. Never enable it for real traffic. Default false.
   */
  allowUnauthorizedTls?: boolean;
}

/**
 * The protected HTTP client (S5): it asks the guard first and then connects to
 * the exact addresses the guard returned, never resolving the name a second
 * time, so a hostile resolver cannot answer public for the check and private
 * for the connection.
 *
 * It never follows redirects: an API base URL has no business redirecting, and
 * refusing removes the whole redirect-to-private-address class.
 */
export function createSafeFetch(deps: CreateSafeFetchDeps): typeof fetch {
  const { guard, allowUnauthorizedTls = false } = deps;

  return async (input, init) => {
    const { url, addresses } = await guard.assertAllowed(
      input instanceof Request ? input.url : String(input),
    );
    if (addresses.length === 0) {
      throw new ForbiddenUrlError("unresolvable");
    }

    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = mergedHeaders(input, init, url);
    const body = await bodyBytes(input, init);

    let lastError: unknown;
    for (const address of addresses) {
      try {
        return await requestOnce(
          address,
          url,
          method,
          headers,
          body,
          allowUnauthorizedTls,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
}

function mergedHeaders(
  input: string | URL | Request,
  init: RequestInit | undefined,
  url: URL,
): Headers {
  const headers = new Headers();
  if (input instanceof Request) {
    for (const [name, value] of input.headers) headers.set(name, value);
  }
  if (init?.headers !== undefined) {
    for (const [name, value] of new Headers(init.headers)) {
      headers.set(name, value);
    }
  }
  // The request leaves with the original name in Host; only the connection
  // itself is pinned to the validated address.
  headers.set("host", url.host);
  return headers;
}

async function bodyBytes(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Buffer | undefined> {
  const body = init?.body ?? (input instanceof Request ? input.body : null);
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), "utf8");
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError("createSafeFetch: unsupported body type");
}

function requestOnce(
  address: string,
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  allowUnauthorizedTls: boolean,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      {
        host: address,
        port: url.port === "" ? 443 : Number.parseInt(url.port, 10),
        path: `${url.pathname}${url.search}`,
        method,
        headers: Object.fromEntries(headers),
        // The certificate is still checked against the original name.
        servername: url.hostname,
        rejectUnauthorized: !allowUnauthorizedTls,
      },
      (response) => {
        try {
          resolve(toResponse(response));
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
    if (body !== undefined) {
      request.end(body);
    } else {
      request.end();
    }
  });
}

function toResponse(response: IncomingMessage): Response {
  const status = response.statusCode ?? 0;
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  // 204/304/101 take no body; the WHATWG Response constructor would refuse one.
  const nullBodyStatus = status === 204 || status === 304 || status === 101;
  const stream = Readable.toWeb(
    response,
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(nullBodyStatus ? null : stream, {
    status,
    statusText: response.statusMessage ?? "",
    headers,
  });
}
