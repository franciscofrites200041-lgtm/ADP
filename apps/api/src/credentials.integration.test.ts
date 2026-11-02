import {
  credentialListResponseSchema,
  credentialResponseSchema,
  providerCatalog,
} from "@middleware/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIntegrationHarness,
  TEST_ORIGIN,
  type TestSession,
  testDatabaseUrl,
} from "./testing/integration-harness.ts";

const url = testDatabaseUrl();

type Harness = Awaited<ReturnType<typeof createIntegrationHarness>>;

describe.skipIf(!url)("credential routes against postgres", () => {
  let harness: Harness;
  let ana: TestSession;
  let beto: TestSession;

  beforeAll(async () => {
    harness = await createIntegrationHarness(url ?? "");
    ana = await harness.signUp("Ana");
    beto = await harness.signUp("Beto");
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  const call = (
    session: TestSession | undefined,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    harness.app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        ...(session ? { cookie: session.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const create = async (session: TestSession, alias: string) => {
    const res = await call(session, "POST", "/api/credentials", {
      providerId: "openai",
      alias,
      apiKey: `sk-test-${alias}-wxyz`,
    });
    expect(res.status).toBe(201);
    return credentialResponseSchema.parse(await res.json());
  };

  const list = async (session: TestSession, query = "") => {
    const res = await call(session, "GET", `/api/credentials${query}`);
    expect(res.status).toBe(200);
    return credentialListResponseSchema.parse(await res.json()).credentials;
  };

  const expectError = async (res: Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: { code, message: expect.any(String) },
    });
  };

  it("answers 401 unauthorized on every route without a session", async () => {
    const id = "0190a5f2-7b1c-7d3e-8f00-000000000001";
    const routes = [
      ["GET", "/api/providers"],
      ["GET", "/api/credentials"],
      ["POST", "/api/credentials"],
      ["PATCH", `/api/credentials/${id}`],
      ["DELETE", `/api/credentials/${id}`],
    ] as const;
    for (const [method, path] of routes) {
      await expectError(
        await call(
          undefined,
          method,
          path,
          method === "GET" ? undefined : { alias: "x" },
        ),
        401,
        "unauthorized",
      );
    }
  });

  it("serves the provider catalog", async () => {
    const res = await call(ana, "GET", "/api/providers");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ providers: providerCatalog });
  });

  it("creates, lists and renames without returning the key", async () => {
    const created = await create(ana, "personal");

    expect(created).toMatchObject({
      providerId: "openai",
      alias: "personal",
      last4: "wxyz",
      status: "unchecked",
      baseUrl: null,
    });
    expect(await list(ana)).toContainEqual(created);

    const res = await call(ana, "PATCH", `/api/credentials/${created.id}`, {
      alias: "trabajo",
    });
    expect(res.status).toBe(200);
    expect(credentialResponseSchema.parse(await res.json())).toEqual({
      ...created,
      alias: "trabajo",
    });
  });

  describe("cross-tenant (S4)", () => {
    it("never shows, edits or archives another workspace's credential", async () => {
      const credential = await create(ana, "ana-only");
      const path = `/api/credentials/${credential.id}`;

      expect(await list(beto)).not.toContainEqual(
        expect.objectContaining({ id: credential.id }),
      );
      await expectError(
        await call(beto, "PATCH", path, { alias: "stolen" }),
        404,
        "not_found",
      );
      await expectError(await call(beto, "DELETE", path), 404, "not_found");
      expect(await list(ana)).toContainEqual(credential);
    });

    it("ignores a workspace id sent in the query or the body", async () => {
      const credential = await create(ana, "ana-query");
      const query = `?workspaceId=${ana.workspaceId}`;

      expect(await list(beto, query)).toEqual(await list(beto));
      await expectError(
        await call(beto, "PATCH", `/api/credentials/${credential.id}${query}`, {
          alias: "stolen",
        }),
        404,
        "not_found",
      );
      // The strict contract rejects unknown fields, so the id never applies.
      await expectError(
        await call(beto, "POST", "/api/credentials", {
          providerId: "openai",
          alias: "planted",
          apiKey: "sk-test-planted-1234",
          workspaceId: ana.workspaceId,
        }),
        400,
        "invalid_request",
      );
      const anaAliases = (await list(ana)).map((c) => c.alias);
      expect(anaAliases).not.toContain("planted");
      expect(anaAliases).toContain("ana-query");
    });
  });

  it("answers 409 alias_taken for a duplicate active alias", async () => {
    await create(ana, "duplicated");

    await expectError(
      await call(ana, "POST", "/api/credentials", {
        providerId: "anthropic",
        alias: "duplicated",
        apiKey: "sk-test-another-1234",
      }),
      409,
      "alias_taken",
    );
  });

  it.each([
    ["a missing key", { providerId: "openai", alias: "no-key" }],
    [
      "an unknown provider",
      { providerId: "acme", alias: "a", apiKey: "k".repeat(9) },
    ],
  ])("answers 400 invalid_request for %s", async (_label, body) => {
    await expectError(
      await call(ana, "POST", "/api/credentials", body),
      400,
      "invalid_request",
    );
  });

  it("rejects a write from another origin and creates nothing (S10)", async () => {
    const before = await call(ana, "GET", "/api/credentials");
    const body = {
      providerId: "openai",
      alias: "cross-site",
      apiKey: "sk-cross-1234",
    };
    const evil = await harness.app.request("/api/credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ana.cookie,
        origin: "https://evil.example.com",
      },
      body: JSON.stringify(body),
    });
    await expectError(evil, 403, "forbidden");
    const missing = await harness.app.request("/api/credentials", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ana.cookie },
      body: JSON.stringify(body),
    });
    await expectError(missing, 403, "forbidden");
    const after = await call(ana, "GET", "/api/credentials");
    expect(await after.json()).toEqual(await before.json());
  });

  it("answers 400 invalid_request for malformed JSON and ids", async () => {
    const res = await harness.app.request("/api/credentials", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: ana.cookie,
        origin: TEST_ORIGIN,
      },
      body: "{not json",
    });
    await expectError(res, 400, "invalid_request");
    await expectError(
      await call(ana, "DELETE", "/api/credentials/not-a-uuid"),
      400,
      "invalid_request",
    );
  });

  it("archives with 204, stops listing it and frees the alias", async () => {
    const credential = await create(ana, "to-archive");

    const res = await call(ana, "DELETE", `/api/credentials/${credential.id}`);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await list(ana)).not.toContainEqual(credential);
    const again = await create(ana, "to-archive");
    expect(again.id).not.toBe(credential.id);
  });
});
