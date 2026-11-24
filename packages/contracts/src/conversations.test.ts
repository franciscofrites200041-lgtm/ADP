import { describe, expect, it } from "vitest";

import {
  conversationListResponseSchema,
  conversationResponseSchema,
  createConversationRequestSchema,
  listMessagesRequestSchema,
  messageListResponseSchema,
  messageResponseSchema,
  renameConversationRequestSchema,
} from "./conversations.ts";

const agentId = "0190a5f2-0000-7000-8000-000000000001";
const conversationId = "0190a5f2-0000-7000-8000-000000000002";
const messageId = "0190a5f2-0000-7000-8000-000000000003";

describe("createConversationRequestSchema", () => {
  it("accepts a conversation for an agent", () => {
    expect(createConversationRequestSchema.parse({ agentId })).toEqual({
      agentId,
    });
  });

  it("rejects unknown keys and a missing agent", () => {
    expect(
      createConversationRequestSchema.safeParse({ agentId, title: "X" })
        .success,
    ).toBe(false);

    expect(createConversationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("renameConversationRequestSchema", () => {
  it("accepts a title and rejects empty or broken ones", () => {
    expect(renameConversationRequestSchema.parse({ title: "Soporte" })).toEqual(
      { title: "Soporte" },
    );

    expect(
      renameConversationRequestSchema.safeParse({ title: "  " }).success,
    ).toBe(false);

    expect(
      renameConversationRequestSchema.safeParse({ title: "So\u0000porte" })
        .success,
    ).toBe(false);
  });
});

describe("listMessagesRequestSchema", () => {
  it("accepts an optional cursor and no extra keys", () => {
    expect(listMessagesRequestSchema.parse({})).toEqual({});

    expect(listMessagesRequestSchema.parse({ cursor: "cm9sZTox" })).toEqual({
      cursor: "cm9sZTox",
    });

    expect(
      listMessagesRequestSchema.safeParse({ cursor: "cm9sZTox", limit: 5 })
        .success,
    ).toBe(false);
  });
});

describe("conversationResponseSchema", () => {
  it("accepts an untitled conversation and rejects extra keys", () => {
    const response = {
      id: conversationId,
      agentId,
      title: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };

    expect(conversationResponseSchema.parse(response)).toEqual(response);

    expect(
      conversationResponseSchema.safeParse({
        ...response,
        workspaceId: agentId,
      }).success,
    ).toBe(false);
  });

  it("paginates the list with a nullable cursor", () => {
    expect(
      conversationListResponseSchema.parse({
        conversations: [],
        nextCursor: null,
      }),
    ).toEqual({ conversations: [], nextCursor: null });

    expect(
      conversationListResponseSchema.safeParse({
        conversations: [],
        nextCursor: null,
        total: 0,
      }).success,
    ).toBe(false);
  });
});

describe("messageResponseSchema", () => {
  it("accepts an assistant message", () => {
    const response = {
      id: messageId,
      role: "assistant",
      content: "Hola, ¿en qué te ayudo?",
      createdAt: "2025-01-01T00:00:01.000Z",
    };

    expect(messageResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects an unknown role and missing content", () => {
    expect(
      messageResponseSchema.safeParse({ id: messageId, role: "system" })
        .success,
    ).toBe(false);

    expect(
      messageResponseSchema.safeParse({ id: messageId, role: "user" }).success,
    ).toBe(false);
  });

  it("paginates the history with a nullable cursor", () => {
    expect(
      messageListResponseSchema.parse({ messages: [], nextCursor: null }),
    ).toEqual({ messages: [], nextCursor: null });

    expect(messageListResponseSchema.safeParse({ messages: [] }).success).toBe(
      false,
    );
  });
});
