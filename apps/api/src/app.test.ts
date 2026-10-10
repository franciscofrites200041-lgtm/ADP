import { describe, expect, it } from "vitest";

import { app } from "./app.ts";

describe("health endpoints", () => {
  it("GET /healthz responds 200", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("GET /readyz responds 200 without PostgreSQL", async () => {
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
  });
});
