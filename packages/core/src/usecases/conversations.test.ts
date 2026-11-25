import type { MessageResponse } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { NotFoundError } from "../domain/errors.ts";
import { createInMemoryConversationPorts } from "../testing/in-memory-conversation-ports.ts";
import { createConversationService } from "./conversations.ts";

const workspaceA = "0190a5f2-0000-7000-8000-00000000000a";
const workspaceB = "0190a5f2-0000-7000-8000-00000000000b";
const agentA = "0190a5f2-0000-7000-8000-0000000000a2";

function setup() {
  const ports = createInMemoryConversationPorts();
  let next = 0;
  const service = createConversationService({
    conversationRepo: ports.conversationRepo,
    messageRepo: ports.messageRepo,
    idGen: {
      newId: () => {
        next += 1;
        return `0190a5f2-0000-7000-8000-${String(next).padStart(12, "0")}`;
      },
    },
  });
  return {
    service,
    conversationRepo: ports.conversationRepo,
    messageRepo: ports.messageRepo,
  };
}

describe("conversation service", () => {
  it("creates a conversation and maps it to the API response", async () => {
    const { service } = setup();

    const created = await service.createConversation(workspaceA, {
      agentId: agentA,
    });

    expect(created.id).toBe("0190a5f2-0000-7000-8000-000000000001");
    expect(created.agentId).toBe(agentA);
    expect(created.title).toBeNull();
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it("lists newest first and pages through a cursor", async () => {
    const { service } = setup();
    for (let index = 0; index < 52; index += 1) {
      await service.createConversation(workspaceA, { agentId: agentA });
    }

    const firstPage = await service.listConversations(workspaceA);
    expect(firstPage.conversations.length).toBe(50);
    expect(firstPage.nextCursor).not.toBeNull();
    // Newest first: the last id created opens the page (§7).
    expect(firstPage.conversations[0]?.id).toBe(
      "0190a5f2-0000-7000-8000-000000000052",
    );

    const secondPage = await service.listConversations(
      workspaceA,
      firstPage.nextCursor ?? "",
    );
    expect(secondPage.conversations.length).toBe(2);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.conversations[0]?.id).toBe(
      "0190a5f2-0000-7000-8000-000000000002",
    );

    const ids = [...firstPage.conversations, ...secondPage.conversations].map(
      (conversation) => conversation.id,
    );
    expect(new Set(ids).size).toBe(52);
  });

  it("rejects a malformed cursor and an unknown anchor", async () => {
    const { service } = setup();
    await service.createConversation(workspaceA, { agentId: agentA });

    await expect(
      service.listConversations(workspaceA, "no-es-un-cursor"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.listConversations(
        workspaceA,
        Buffer.from(
          JSON.stringify({ id: "0190a5f2-0000-7000-8000-000000000099" }),
        ).toString("base64url"),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("renames and archives; a missing conversation reads as missing", async () => {
    const { service } = setup();
    const created = await service.createConversation(workspaceA, {
      agentId: agentA,
    });

    const renamed = await service.renameConversation(workspaceA, created.id, {
      title: "Consulta de factura",
    });
    expect(renamed.title).toBe("Consulta de factura");
    expect(renamed.updatedAt > renamed.createdAt).toBe(true);

    await service.archiveConversation(workspaceA, created.id);
    // Archived reads as missing for every further path (§7).
    await expect(
      service.renameConversation(workspaceA, created.id, { title: "Revivir" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.archiveConversation(workspaceA, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const listed = await service.listConversations(workspaceA);
    expect(listed.conversations).toEqual([]);
  });

  // Cross-tenant behaviour is deliberately not tested here: AGENTS.md forbids an
  // in-memory double for it. That a foreign conversation lists as empty, reads
  // as missing and refuses a rename is proven against real Postgres in
  // apps/api/src/conversation-routes.integration.test.ts.

  it("pages the message history with the repo cursor (§10)", async () => {
    const { service, messageRepo } = setup();
    const created = await service.createConversation(workspaceA, {
      agentId: agentA,
    });
    for (let index = 0; index < 55; index += 1) {
      await messageRepo.append(workspaceA, {
        id: `0190a5f2-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
        conversationId: created.id,
        runId: null,
        role: "user",
        content: `mensaje ${index}`,
      });
    }

    const firstPage = await service.listMessages(workspaceA, created.id);
    expect(firstPage.messages.length).toBe(50);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.messages[0]?.content).toBe("mensaje 0");

    const secondPage = await service.listMessages(
      workspaceA,
      created.id,
      firstPage.nextCursor ?? "",
    );
    expect(secondPage.messages.length).toBe(5);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.messages[0]?.content).toBe("mensaje 50");

    const all: MessageResponse[] = [
      ...firstPage.messages,
      ...secondPage.messages,
    ];
    expect(all.length).toBe(55);
    expect(new Set(all.map((message) => message.id)).size).toBe(55);
    // Ascending by creation, the order the transcript renders (§10).
    expect(all.at(-1)?.content).toBe("mensaje 54");
  });

  it("rejects a malformed history cursor", async () => {
    const { service } = setup();
    const created = await service.createConversation(workspaceA, {
      agentId: agentA,
    });
    await expect(
      service.listMessages(workspaceA, created.id, "no-es-un-cursor"),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
