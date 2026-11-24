import { describe, expect, it } from "vitest";

import {
  createRunRequestSchema,
  runResponseSchema,
  runStatusSchema,
} from "./runs.ts";

const agentId = "0190a5f2-0000-7000-8000-000000000001";
const conversationId = "0190a5f2-0000-7000-8000-000000000002";
const agentVersionId = "0190a5f2-0000-7000-8000-000000000003";

describe("createRunRequestSchema", () => {
  it("accepts a chat run inside a conversation", () => {
    const input = { agentId, conversationId, input: "Hola" };

    expect(createRunRequestSchema.parse(input)).toEqual(input);
  });

  it("accepts a background run without a conversation", () => {
    expect(
      createRunRequestSchema.parse({
        agentId,
        input: "Hola",
        background: true,
      }),
    ).toEqual({ agentId, input: "Hola", background: true });
  });

  it("rejects unknown extra keys", () => {
    expect(
      createRunRequestSchema.safeParse({
        agentId,
        input: "Hola",
        groupId: conversationId,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing agent id or an empty input", () => {
    expect(createRunRequestSchema.safeParse({ input: "Hola" }).success).toBe(
      false,
    );

    expect(
      createRunRequestSchema.safeParse({ agentId, input: "   " }).success,
    ).toBe(false);
  });

  it("trims the input and rejects a non-boolean background", () => {
    expect(
      createRunRequestSchema.parse({ agentId, input: "  Hola  " }),
    ).toEqual({ agentId, input: "Hola" });

    expect(
      createRunRequestSchema.safeParse({
        agentId,
        input: "Hola",
        background: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("runStatusSchema", () => {
  it("declares exactly the six states of §5", () => {
    expect(runStatusSchema.options).toEqual([
      "queued",
      "running",
      "waiting_approval",
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });
});

describe("runResponseSchema", () => {
  it("accepts a finished run without a group", () => {
    const response = {
      id: agentId,
      agentId,
      agentVersionId,
      conversationId,
      status: "succeeded",
      input: "Hola",
      output: "Hola, ¿cómo estás?",
      errorCode: null,
      errorMessage: null,
      queuedAt: "2025-01-01T00:00:00.000Z",
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "2025-01-01T00:00:01.000Z",
    };

    expect(runResponseSchema.parse(response)).toEqual(response);
  });

  it("rejects an unknown status and unknown keys", () => {
    expect(runResponseSchema.safeParse({ status: "paused" }).success).toBe(
      false,
    );

    expect(
      runResponseSchema.safeParse({
        id: agentId,
        agentId,
        agentVersionId,
        conversationId: null,
        status: "queued",
        input: "Hola",
        output: null,
        errorCode: null,
        errorMessage: null,
        queuedAt: "2025-01-01T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
        groupId: null,
      }).success,
    ).toBe(false);
  });
});
