import { describe, expect, it } from "vitest";

import { createApp, type ReadinessChecker } from "./app.ts";

describe("health endpoints", () => {
  it("GET /healthz responds 200 without a readiness check", async () => {
    const app = createApp({ ready: async () => true });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  describe("GET /readyz", () => {
    it("responds 200 when the readiness checker resolves true", async () => {
      const app = createApp({ ready: async () => true });
      const res = await app.request("/readyz");
      expect(res.status).toBe(200);
    });

    it("responds 503 when the readiness checker resolves false", async () => {
      const app = createApp({ ready: async () => false });
      const res = await app.request("/readyz");
      expect(res.status).toBe(503);
    });

    it("responds 503 when the readiness checker rejects", async () => {
      const failing: ReadinessChecker = async () => {
        throw new Error("connection refused");
      };
      const app = createApp({ ready: failing });
      const res = await app.request("/readyz");
      expect(res.status).toBe(503);
    });
  });
});
