import { generateKeyPairSync, sign, X509Certificate } from "node:crypto";
import type http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { TLSSocket } from "node:tls";
import type { UrlGuard } from "@middleware/core";
import { ForbiddenUrlError } from "@middleware/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createSafeFetch } from "./safe-fetch.ts";

/* ------------------------------------------------------------------ *
 * Fixture: a throwaway self-signed key/cert for `example.test`, built
 * in-process with node:crypto only (no openssl, no dependency). A
 * minimal v3 X.509 DER is hand-encoded: enough structure for the local
 * server to serve TLS and for Node to parse and check it.
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
  // [3] EXPLICIT wrapper around the SEQUENCE OF Extension.
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

const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const certPem = toPem(certDer, "CERTIFICATE");

/* ------------------------------------------------------------------ *
 * Local HTTPS server bound to 127.0.0.1 that records what arrives.
 * ------------------------------------------------------------------ */

interface SeenRequest {
  method: string | undefined;
  host: string | undefined;
  sni: string | false | null | undefined;
  remoteAddress: string | undefined;
  body: string;
  path: string | undefined;
  headers: http.IncomingHttpHeaders;
}

const seen: SeenRequest[] = [];
let server: https.Server;
let port = 0;
const baseUrl = () => `https://example.test:${port}`;

beforeAll(async () => {
  server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const socket = req.socket;
      seen.push({
        method: req.method,
        host: req.headers.host,
        sni: socket instanceof TLSSocket ? socket.servername : undefined,
        remoteAddress: socket.remoteAddress ?? undefined,
        body: Buffer.concat(chunks).toString("utf8"),
        path: req.url,
        headers: req.headers,
      });
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/landing" });
        res.end();
        return;
      }
      if (req.url === "/no-content") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`hello from ${String(req.headers.host)}`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo | string | null;
  if (address === null || typeof address === "string") {
    throw new Error("test server did not report a port");
  }
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* ------------------------------------------------------------------ */

const guardFor = (addresses: string[]): UrlGuard => ({
  assertAllowed: vi.fn(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses,
  })),
});

const refusingGuard = (reason: ForbiddenUrlError["reason"]): UrlGuard => ({
  assertAllowed: vi.fn(async () => {
    throw new ForbiddenUrlError(reason);
  }),
});

const requestCount = () => seen.length;

describe("safe fetch fixture", () => {
  it("generates a self-signed certificate the fixture key really owns", () => {
    const certificate = new X509Certificate(certPem);
    expect(certificate.subject).toContain("CN=example.test");
    expect(certificate.checkPrivateKey(privateKey)).toBe(true);
    expect(certificate.checkHost("example.test")).toBe("example.test");
  });
});

describe("safe fetch", () => {
  it("returns the body of a successful request from the local https server", async () => {
    const safeFetch = createSafeFetch({
      guard: guardFor(["127.0.0.1"]),
      allowUnauthorizedTls: true,
    });
    const response = await safeFetch(`${baseUrl()}/greeting`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe(`hello from example.test:${port}`);
  });

  it("connects to the address the guard pinned, keeping the name for TLS and Host", async () => {
    const guard = guardFor(["127.0.0.1"]);
    const safeFetch = createSafeFetch({
      guard,
      allowUnauthorizedTls: true,
    });
    const before = requestCount();
    await safeFetch(`${baseUrl()}/greeting`);
    expect(guard.assertAllowed).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(before + 1);
    const request = seen[before];
    expect(request?.remoteAddress).toBe("127.0.0.1");
    expect(request?.sni).toBe("example.test");
    expect(request?.host).toBe(`example.test:${port}`);
  });

  it("refuses before connecting when the guard throws", async () => {
    const safeFetch = createSafeFetch({
      guard: refusingGuard("private"),
    });
    const before = requestCount();
    await expect(safeFetch(`${baseUrl()}/greeting`)).rejects.toBeInstanceOf(
      ForbiddenUrlError,
    );
    expect(requestCount()).toBe(before);
  });

  it("returns a redirect to the caller without following it", async () => {
    const safeFetch = createSafeFetch({
      guard: guardFor(["127.0.0.1"]),
      allowUnauthorizedTls: true,
    });
    const before = requestCount();
    const response = await safeFetch(`${baseUrl()}/redirect`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/landing");
    // One request seen means the 302 was handed back, not chased.
    expect(requestCount()).toBe(before + 1);
  });

  it("fails rather than silently trusting a self-signed server when allowUnauthorizedTls is false", async () => {
    const safeFetch = createSafeFetch({ guard: guardFor(["127.0.0.1"]) });
    const before = requestCount();
    await expect(safeFetch(`${baseUrl()}/greeting`)).rejects.toThrow(
      /certificate/i,
    );
    expect(requestCount()).toBe(before);
  });

  it("takes method, headers and body from a Request when given one", async () => {
    const safeFetch = createSafeFetch({
      guard: guardFor(["127.0.0.1"]),
      allowUnauthorizedTls: true,
    });
    const request = new Request(`${baseUrl()}/echo`, {
      method: "POST",
      headers: { "x-echo": "1" },
      body: "ping",
    });
    const before = requestCount();
    const response = await safeFetch(request);
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(before + 1);
    const received = seen[before];
    expect(received?.method).toBe("POST");
    expect(received?.body).toBe("ping");
    expect(received?.headers["x-echo"]).toBe("1");
  });

  it("returns a 204 as a Response with an empty body", async () => {
    const safeFetch = createSafeFetch({
      guard: guardFor(["127.0.0.1"]),
      allowUnauthorizedTls: true,
    });
    const response = await safeFetch(`${baseUrl()}/no-content`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
