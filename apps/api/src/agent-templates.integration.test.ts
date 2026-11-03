import {
  agentListResponseSchema,
  agentResponseSchema,
  agentTemplateListResponseSchema,
} from "@middleware/contracts";
import { seedAgentTemplates, seedDatabase } from "@middleware/db";
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

// The skip is safe only because integration-env.test.ts fails loudly when
// DATABASE_URL_TEST is missing: the suite cannot go green without a database.
describe.skipIf(url === undefined)("agent templates (postgres)", () => {
  let harness: Harness;
  let ana: TestSession;

  beforeAll(async () => {
    harness = await createIntegrationHarness(url ?? "");
    ana = await harness.signUp("Ana");
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  const call = (method: string, path: string, body?: unknown) =>
    harness.app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        cookie: ana.cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const templates = async () =>
    agentTemplateListResponseSchema.parse(
      await (await call("GET", "/api/agent-templates")).json(),
    ).templates;

  it("seeds the six templates named by the master, and seeding twice changes nothing", async () => {
    // Twice on purpose: the seed must be idempotent.
    await seedDatabase(url ?? "");
    await seedDatabase(url ?? "");

    const listed = await templates();
    expect(listed).toHaveLength(6);
    expect(listed.map((template) => template.name).sort()).toEqual([
      "Analista de datos con código",
      "Integrador HTTP",
      "Investigación web",
      "Redacción",
      "Resumen diario programado",
      "Soporte",
    ]);
    // Idempotent by primary key: the same seed must not add rows.
    expect(new Set(listed.map((template) => template.id)).size).toBe(6);
  });

  it("creates a chat-ready agent from a template by choosing only a credential", async () => {
    const credential = await call("POST", "/api/credentials", {
      providerId: "openai",
      alias: "para-plantilla",
      apiKey: "sk-test-plantilla-wxyz",
    });
    const credentialId = z
      .object({ id: z.uuid() })
      .parse(await credential.json()).id;

    const support = (await templates()).find(
      (template) => template.name === "Soporte",
    );
    if (!support) throw new Error("the Soporte template is missing");

    // Only the credential and the model are chosen: the rest comes from the
    // template, which is the acceptance for WP-21.
    const res = await call("POST", "/api/agents", {
      name: support.name,
      ...(support.description === null
        ? {}
        : { description: support.description }),
      templateId: support.id,
      version: {
        instructions: support.instructions,
        providerId: "openai",
        modelId: "gpt-5",
        credentialId,
        params: support.suggestedParams,
        tools: support.suggestedTools,
      },
    });

    expect(res.status).toBe(201);
    const created = agentResponseSchema.parse(await res.json());
    expect(created.currentVersion?.instructions).toBe(support.instructions);
    expect(created.currentVersion?.credentialId).toBe(credentialId);

    const listed = agentListResponseSchema.parse(
      await (await call("GET", "/api/agents")).json(),
    ).agents;
    expect(listed.map((agent) => agent.name)).toContain("Soporte");
  });

  it("requires a session: the catalogue is product content, not public data", async () => {
    const anonymous = await harness.app.request("/api/agent-templates", {
      method: "GET",
      headers: { origin: TEST_ORIGIN },
    });

    expect(anonymous.status).toBe(401);
  });

  it("serves the same catalogue to every workspace: it is global, not tenant data", async () => {
    const anaTemplates = await templates();
    const beto = await harness.signUp("Beto");
    const betoTemplates = agentTemplateListResponseSchema.parse(
      await (
        await harness.app.request("/api/agent-templates", {
          method: "GET",
          headers: { origin: TEST_ORIGIN, cookie: beto.cookie },
        })
      ).json(),
    ).templates;

    // Identical, and no workspace ids anywhere: nothing tenant-scoped leaks.
    expect(betoTemplates).toEqual(anaTemplates);
    expect(JSON.stringify(anaTemplates)).not.toContain(ana.workspaceId);
  });

  it("exposes the seed step so the pipeline can run it", () => {
    expect(seedAgentTemplates.name).toBe("agent-templates");
  });
});
