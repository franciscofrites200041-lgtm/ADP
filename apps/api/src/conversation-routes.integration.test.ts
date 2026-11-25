import {
  conversationListResponseSchema,
  conversationResponseSchema,
  messageListResponseSchema,
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

describe.skipIf(url === undefined)("conversation routes (postgres)", () => {
  let harness: Harness;
  let ana: TestSession;
  let beto: TestSession;
  let agentId: string;

  beforeAll(async () => {
    harness = await createIntegrationHarness(url ?? "");
    ana = await harness.signUp("Ana");
    beto = await harness.signUp("Beto");
    const credential = z.object({ id: z.uuid() }).parse(
      await (
        await call(ana, "POST", "/api/credentials", {
          providerId: "openai",
          alias: "ana-1",
          apiKey: "sk-test-ana-wxyz",
        })
      ).json(),
    ).id;
    agentId = z.object({ id: z.uuid() }).parse(
      await (
        await call(ana, "POST", "/api/agents", {
          name: "Soporte",
          version: {
            instructions: "Sos Soporte.",
            providerId: "openai",
            modelId: "test-model",
            credentialId: credential,
            params: { temperature: 0.2 },
            tools: [],
          },
        })
      ).json(),
    ).id;
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  const call = (
    session: TestSession,
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

  const createConversation = async (session: TestSession, agent: string) => {
    const res = await call(session, "POST", "/api/conversations", {
      agentId: agent,
    });
    expect(res.status).toBe(201);
    return conversationResponseSchema.parse(await res.json());
  };

  /** Seeds history directly, the way runs would have appended it (§7). */
  const seedMessages = async (
    workspaceId: string,
    conversationId: string,
    count: number,
  ) => {
    for (let index = 0; index < count; index += 1) {
      await harness.sql`
        insert into message (id, workspace_id, conversation_id, role, content)
        values (gen_random_uuid(), ${workspaceId}, ${conversationId}, 'user',
          ${JSON.stringify(`mensaje ${index}`)})`;
    }
  };

  it("creates, lists, renames and archives conversations", async () => {
    const created = await createConversation(ana, agentId);
    expect(created.title).toBeNull();
    expect(created.agentId).toBe(agentId);

    const listed = conversationListResponseSchema.parse(
      await (await call(ana, "GET", "/api/conversations")).json(),
    );
    expect(listed.conversations.map((c) => c.id)).toContain(created.id);
    expect(listed.nextCursor).toBeNull();

    const renamed = conversationResponseSchema.parse(
      await (
        await call(ana, "PATCH", `/api/conversations/${created.id}`, {
          title: "Consulta de factura",
        })
      ).json(),
    );
    expect(renamed.title).toBe("Consulta de factura");

    const archived = await call(
      ana,
      "DELETE",
      `/api/conversations/${created.id}`,
    );
    expect(archived.status).toBe(204);
    const afterList = conversationListResponseSchema.parse(
      await (await call(ana, "GET", "/api/conversations")).json(),
    );
    expect(afterList.conversations.map((c) => c.id)).not.toContain(created.id);
    // An archived conversation reads as missing for every path (§7).
    await expectError(
      await call(ana, "PATCH", `/api/conversations/${created.id}`, {
        title: "Revivir",
      }),
      404,
      "not_found",
    );
    await expectError(
      await call(ana, "DELETE", `/api/conversations/${created.id}`),
      404,
      "not_found",
    );
    await expectError(
      await call(ana, "GET", `/api/conversations/${created.id}/messages`),
      404,
      "not_found",
    );
  });

  it("keeps another workspace's conversation invisible", async () => {
    const conversation = await createConversation(ana, agentId);

    await expectError(
      await call(beto, "POST", "/api/conversations", { agentId }),
      404,
      "not_found",
    );
    const betoList = conversationListResponseSchema.parse(
      await (await call(beto, "GET", "/api/conversations")).json(),
    );
    expect(betoList.conversations).toEqual([]);
    await expectError(
      await call(beto, "GET", `/api/conversations/${conversation.id}/messages`),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "PATCH", `/api/conversations/${conversation.id}`, {
        title: "Robado",
      }),
      404,
      "not_found",
    );
    await expectError(
      await call(beto, "DELETE", `/api/conversations/${conversation.id}`),
      404,
      "not_found",
    );
  });

  it("pages the message history with the cursor (§10)", async () => {
    const conversation = await createConversation(ana, agentId);
    await seedMessages(ana.workspaceId, conversation.id, 55);

    const firstPage = messageListResponseSchema.parse(
      await (
        await call(ana, "GET", `/api/conversations/${conversation.id}/messages`)
      ).json(),
    );
    expect(firstPage.messages.length).toBe(50);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.messages[0]?.content).toBe("mensaje 0");

    const historyUrl =
      `/api/conversations/${conversation.id}/messages` +
      `?cursor=${firstPage.nextCursor ?? ""}`;
    const secondPage = messageListResponseSchema.parse(
      await (await call(ana, "GET", historyUrl)).json(),
    );
    expect(secondPage.messages.length).toBe(5);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.messages[0]?.content).toBe("mensaje 50");

    const all = [...firstPage.messages, ...secondPage.messages];
    expect(all.length).toBe(55);
    expect(new Set(all.map((message) => message.id)).size).toBe(55);
    const times = all.map((message) => message.createdAt);
    expect([...times].sort()).toEqual(times);
    expect(all.at(-1)?.content).toBe("mensaje 54");
  });

  it("rejects a malformed cursor and an invalid agent", async () => {
    const conversation = await createConversation(ana, agentId);

    await expectError(
      await call(
        ana,
        "GET",
        `/api/conversations/${conversation.id}/messages?cursor=no-such-cursor`,
      ),
      400,
      "invalid_request",
    );
    await expectError(
      await call(ana, "POST", "/api/conversations", { agentId: "no-es-uuid" }),
      400,
      "invalid_request",
    );
    // A foreign agent id reads as missing (S4).
    const foreignCredential = z.object({ id: z.uuid() }).parse(
      await (
        await call(beto, "POST", "/api/credentials", {
          providerId: "openai",
          alias: "beto-1",
          apiKey: "sk-test-beto-wxyz",
        })
      ).json(),
    ).id;
    const foreignAgent = z.object({ id: z.uuid() }).parse(
      await (
        await call(beto, "POST", "/api/agents", {
          name: "Ajeno",
          version: {
            instructions: "Sos ajeno.",
            providerId: "openai",
            modelId: "test-model",
            credentialId: foreignCredential,
            params: { temperature: 0.2 },
            tools: [],
          },
        })
      ).json(),
    ).id;
    await expectError(
      await call(ana, "POST", "/api/conversations", { agentId: foreignAgent }),
      404,
      "not_found",
    );
  });
});
