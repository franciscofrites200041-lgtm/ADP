import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createErrorHandler } from "./http-errors.ts";
import { createLogger } from "./logger.ts";
import { requireOrigin } from "./origin.ts";

const allowed = "https://app.example.com";

function app() {
  const hono = new Hono();
  hono.onError(createErrorHandler(createLogger({ write() {} })));
  hono.post("/writes", requireOrigin([allowed]), (c) => c.text("ok", 201));
  return hono;
}

const post = (headers: Record<string, string> = {}) =>
  app().request("/writes", { method: "POST", headers });

describe("requireOrigin (S10)", () => {
  it("accepts the allowed origin and returns the handler result", async () => {
    expect((await post({ origin: allowed })).status).toBe(201);
  });

  it("accepts a matching referer when the origin header is absent", async () => {
    expect((await post({ referer: `${allowed}/providers` })).status).toBe(201);
  });

  it("rejects another origin with 403 forbidden", async () => {
    const res = await post({ origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "forbidden",
        message: "No pudimos verificar el origen del pedido.",
      },
    });
  });

  it("rejects a missing origin and referer", async () => {
    expect((await post()).status).toBe(403);
  });

  it("rejects a referer from another site", async () => {
    expect((await post({ referer: "https://evil.example.com/x" })).status).toBe(
      403,
    );
  });

  it("rejects a malformed referer without throwing", async () => {
    expect((await post({ referer: "not a url" })).status).toBe(403);
  });
});
