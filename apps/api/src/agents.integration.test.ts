import {
  agentListResponseSchema,
  agentResponseSchema,
  agentVersionResponseSchema,
} from "@middleware/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createIntegrationHarness,
  TEST_ORIGIN,
  type TestSession,
  testDatabaseUrl,
} from "./testing/integration-harness.ts";

type Harness = Awaited<ReturnType<typeof createIntegrationHarness>>;

const url = testDatabaseUrl();

describe.skipIf(url === undefined)("agents API (postgres)", () => {
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

  const expectError = async (res: Response, status: number, code: string) => {
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: { code, message: expect.any(String) },
    });
  };

  const credential = async (session: TestSession, alias: string) => {
    const res = await call(session, "POST", "/api/credentials", {
      providerId: "openai",
      alias,
      apiKey: `sk-test-${alias}-wxyz`,
    });
    expect(res.status).toBe(201);
    const created = z.object({ id: z.uuid() }).parse(await res.json());
    return created.id;
  };

  const versionOf = (credentialId: string, instructions: string) => ({
    instructions,
    providerId: "openai",
    modelId: "gpt-5",
    credentialId,
    params: { temperature: 0.2 },
    tools: ["web_search"],
  });

  const create = async (
    session: TestSession,
    name: string,
    instructions: string,
    credentialId?: string,
  ) => {
    const credentialKey = credentialId ?? (await credential(session, name));
    const res = await call(session, "POST", "/api/agents", {
      name,
      version: versionOf(credentialKey, instructions),
    });
    expect(res.status).toBe(201);
    return agentResponseSchema.parse(await res.json());
  };

  const versions = async (session: TestSession, agentId: string) => {
    const res = await call(session, "GET", `/api/agents/${agentId}/versions`);
    expect(res.status).toBe(200);
    return z
      .object({ versions: z.array(agentVersionResponseSchema) })
      .parse(await res.json()).versions;
  };

  it("creates an agent whose first version is current", async () => {
    const agent = await create(ana, "Soporte", "Atendé consultas.");

    expect(agent.name).toBe("Soporte");
    expect(agent.currentVersion?.version).toBe(1);
    expect(agent.archivedAt).toBeNull();
  });

  it("editing appends a version instead of rewriting the previous one", async () => {
    const agent = await create(ana, "Editable", "Primera.");
    const credentialId = agent.currentVersion?.credentialId;
    if (!credentialId) throw new Error("missing credential");

    const res = await call(ana, "PATCH", `/api/agents/${agent.id}`, {
      version: versionOf(credentialId, "Segunda."),
    });

    expect(res.status).toBe(200);
    const updated = agentResponseSchema.parse(await res.json());
    expect(updated.currentVersion?.version).toBe(2);
    expect((await versions(ana, agent.id)).map((v) => v.instructions)).toEqual([
      "Segunda.",
      "Primera.",
    ]);
  });

  it("restoring an old version appends a new one with its content", async () => {
    const agent = await create(ana, "Restaurable", "Primera.");
    const first = agent.currentVersion;
    if (!first?.credentialId) throw new Error("missing first version");
    await call(ana, "PATCH", `/api/agents/${agent.id}`, {
      version: versionOf(first.credentialId, "Segunda."),
    });

    const res = await call(ana, "POST", `/api/agents/${agent.id}/restore`, {
      versionId: first.id,
    });

    expect(res.status).toBe(200);
    const restored = agentResponseSchema.parse(await res.json());
    expect(restored.currentVersion?.version).toBe(3);
    expect(restored.currentVersion?.instructions).toBe("Primera.");
  });

  it("refuses a credential from another workspace", async () => {
    const foreign = await credential(beto, "ajena");

    const res = await call(ana, "POST", "/api/agents", {
      name: "Intruso",
      version: versionOf(foreign, "X."),
    });

    await expectError(res, 404, "not_found");
    const listed = agentListResponseSchema.parse(
      await (await call(ana, "GET", "/api/agents")).json(),
    );
    expect(listed.agents.map((agent) => agent.name)).not.toContain("Intruso");
  });

  it("keeps another workspace's agents invisible", async () => {
    const agent = await create(ana, "Privado", "Solo de Ana.");

    await expectError(
      await call(beto, "GET", `/api/agents/${agent.id}`),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "GET", `/api/agents/${agent.id}/versions`),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "DELETE", `/api/agents/${agent.id}`),
      404,
      "not_found",
    );
    // Every write path is covered: a leaked PATCH, restore or duplicate would be
    // exactly as bad as a leaked read.
    await expectError(
      await call(beto, "PATCH", `/api/agents/${agent.id}`, { name: "Robado" }),
      404,
      "not_found",
    );
    const versionId = agent.currentVersion?.id;
    if (!versionId) throw new Error("missing version");
    await expectError(
      await call(beto, "POST", `/api/agents/${agent.id}/restore`, {
        versionId,
      }),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "POST", `/api/agents/${agent.id}/duplicate`, {
        name: "Robado",
      }),
      404,
      "not_found",
    );
    const listed = agentListResponseSchema.parse(
      await (await call(beto, "GET", "/api/agents")).json(),
    );
    expect(listed.agents).toEqual([]);
  });

  it("duplicates an agent with a copy of its current version", async () => {
    const agent = await create(ana, "Original", "Contenido original.");

    const res = await call(ana, "POST", `/api/agents/${agent.id}/duplicate`, {
      name: "Copia",
    });

    expect(res.status).toBe(201);
    const copy = agentResponseSchema.parse(await res.json());
    expect(copy.id).not.toBe(agent.id);
    expect(copy.name).toBe("Copia");
    expect(copy.currentVersion?.instructions).toBe("Contenido original.");
  });
});
