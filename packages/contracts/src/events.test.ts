import { describe, expect, it } from "vitest";

import { runEventSchema, runEventTypes, sseFrame } from "./events.ts";

const runId = "0190a5f2-0000-7000-8000-000000000001";
const messageId = "0190a5f2-0000-7000-8000-000000000002";
const toolCallId = "0190a5f2-0000-7000-8000-000000000003";
const approvalId = "0190a5f2-0000-7000-8000-000000000004";
const childRunId = "0190a5f2-0000-7000-8000-000000000005";
const agentVersionId = "0190a5f2-0000-7000-8000-000000000006";

describe("runEventSchema", () => {
  it("declares exactly the sixteen types of §10", () => {
    expect(runEventTypes).toHaveLength(16);
  });

  it("accepts the agent-level events WP-30 emits", () => {
    expect(
      runEventSchema.parse({
        type: "run.started",
        runId,
        agentVersionId,
        model: "gpt-5",
      }),
    ).toEqual({
      type: "run.started",
      runId,
      agentVersionId,
      model: "gpt-5",
    });

    expect(
      runEventSchema.parse({ type: "message.delta", messageId, text: "Ho" }),
    ).toEqual({ type: "message.delta", messageId, text: "Ho" });

    expect(
      runEventSchema.parse({
        type: "message.completed",
        messageId,
        content: "Hola",
      }),
    ).toEqual({ type: "message.completed", messageId, content: "Hola" });

    expect(
      runEventSchema.parse({
        type: "tool.completed",
        toolCallId,
        status: "succeeded",
        resultPreview: "42",
        durationMs: 120,
      }).type,
    ).toBe("tool.completed");

    expect(
      runEventSchema.parse({
        type: "approval.requested",
        approvalId,
        toolCallId,
        summary: "Enviar correo",
        expiresAt: "2025-01-01T00:00:00.000Z",
      }).type,
    ).toBe("approval.requested");

    const resolved = runEventSchema.parse({
      type: "approval.resolved",
      approvalId,
      decision: "approved",
    });
    expect(resolved.type).toBe("approval.resolved");

    expect(
      runEventSchema.parse({
        type: "usage",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.5,
      }).type,
    ).toBe("usage");

    expect(
      runEventSchema.parse({
        type: "run.completed",
        output: "Listo",
        finishedAt: "2025-01-01T00:00:00.000Z",
      }).type,
    ).toBe("run.completed");

    expect(
      runEventSchema.parse({
        type: "run.failed",
        code: "rate_limited",
        message: "Demasiadas solicitudes",
      }).type,
    ).toBe("run.failed");

    expect(runEventSchema.parse({ type: "run.cancelled" })).toEqual({
      type: "run.cancelled",
    });
  });

  it("accepts the declared group and delivery events", () => {
    expect(
      runEventSchema.parse({
        type: "delegation.started",
        childRunId,
        memberSlug: "investigador",
        memberName: "Investigador",
        task: "Buscar datos",
      }).type,
    ).toBe("delegation.started");

    expect(
      runEventSchema.parse({
        type: "delegation.completed",
        childRunId,
        status: "failed",
        outputPreview: "",
        costUsd: 0,
      }).type,
    ).toBe("delegation.completed");

    expect(
      runEventSchema.parse({
        type: "delivery.updated",
        channelKind: "whatsapp",
        status: "sent",
      }).type,
    ).toBe("delivery.updated");
  });

  it("rejects unknown extra keys and unknown types", () => {
    expect(
      runEventSchema.safeParse({
        type: "run.started",
        runId,
        agentVersionId,
        model: "gpt-5",
        extra: 1,
      }).success,
    ).toBe(false);

    expect(runEventSchema.safeParse({ type: "run.paused" }).success).toBe(
      false,
    );

    expect(runEventSchema.safeParse({ type: "usage" }).success).toBe(false);
  });

  it("nests a child run event recursively", () => {
    const child = {
      type: "message.delta",
      messageId,
      text: "desde el hijo",
    };

    expect(
      runEventSchema.parse({ type: "child.event", childRunId, event: child }),
    ).toEqual({ type: "child.event", childRunId, event: child });

    const grandchild = { type: "child.event", childRunId, event: child };
    expect(
      runEventSchema.parse({
        type: "child.event",
        childRunId,
        event: grandchild,
      }).type,
    ).toBe("child.event");

    expect(
      runEventSchema.safeParse({
        type: "child.event",
        childRunId,
        event: { type: "run.started", runId: "no-uuid" },
      }).success,
    ).toBe(false);
  });
});

describe("sseFrame", () => {
  it("writes id, event and data lines followed by the blank line", () => {
    const frame = sseFrame(
      { type: "run.started", runId, agentVersionId, model: "gpt-5" },
      7,
    );

    expect(frame).toBe(
      `id: 7\nevent: run.started\ndata: {"type":"run.started",` +
        `"runId":"${runId}","agentVersionId":"${agentVersionId}",` +
        `"model":"gpt-5"}\n\n`,
    );
  });

  it("uses the event type as the SSE event name", () => {
    const frame = sseFrame({ type: "run.cancelled" }, 0);

    expect(frame).toBe(
      `id: 0\nevent: run.cancelled\ndata: {"type":"run.cancelled"}\n\n`,
    );
  });
});
