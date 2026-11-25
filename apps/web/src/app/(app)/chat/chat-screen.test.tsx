// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { messages } from "../../../messages.ts";
import { ChatScreen } from "./chat-screen.tsx";

const AGENT_ID = "0190a5f2-0000-7000-8000-000000000001";
const CONVERSATION_ID = "0190a5f2-0000-7000-8000-000000000002";
const RUN_ID = "0190a5f2-0000-7000-8000-000000000003";
const VERSION_ID = "0190a5f2-0000-7000-8000-000000000000";
const MESSAGE_ID = "0190a5f2-0000-7000-8000-000000000004";
const USER_MESSAGE_ID = "0190a5f2-0000-7000-8000-000000000005";
const NOW = new Date().toISOString();

const agent = {
  id: AGENT_ID,
  name: "Soporte",
  description: null,
  currentVersion: null,
  archivedAt: null,
};

const conversation = {
  id: CONVERSATION_ID,
  agentId: AGENT_ID,
  title: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const userMessage = {
  id: USER_MESSAGE_ID,
  role: "user",
  content: "¿Cómo estás?",
  createdAt: NOW,
};

const assistantMessage = {
  id: MESSAGE_ID,
  role: "assistant",
  content: "Hola",
  createdAt: NOW,
};

const started = {
  type: "run.started",
  runId: RUN_ID,
  agentVersionId: VERSION_ID,
  model: "test-model",
};

const delta = (text: string) => ({
  type: "message.delta",
  messageId: MESSAGE_ID,
  text,
});

const completed = {
  type: "message.completed",
  messageId: MESSAGE_ID,
  content: "Hola",
};

const runCompleted = {
  type: "run.completed",
  output: "Hola",
  finishedAt: NOW,
};

const historyResponse = {
  messages: [userMessage, assistantMessage],
  nextCursor: null,
};

const frame = <T extends { type: string }>(seq: number, event: T): string =>
  `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** Frames are enqueued; with `hang` the stream never closes. */
const sseResponse = (frames: string[], hang = false): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of frames) controller.enqueue(encoder.encode(text));
        if (!hang) controller.close();
      },
    }),
    { status: 200 },
  );
};

const fullAnswer = () => [
  frame(1, started),
  frame(2, delta("Hol")),
  frame(3, delta("a")),
  frame(4, completed),
  frame(5, runCompleted),
];

type Handler = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
) => Response;

type Routes = Record<string, Handler>;

function baseRoutes(): Routes {
  return {
    "GET /api/agents": () =>
      new Response(JSON.stringify({ agents: [agent] }), { status: 200 }),
    "POST /api/conversations": () =>
      new Response(JSON.stringify(conversation), { status: 201 }),
    "GET /api/conversations/:id/messages": () =>
      new Response(JSON.stringify(historyResponse), { status: 200 }),
    "GET /api/runs/:id/events": () => sseResponse(fullAnswer(), true),
    "POST /api/runs": () => sseResponse(fullAnswer(), true),
  };
}

function routeKey(input: RequestInfo | URL, method: string): string {
  const url = new URL(
    typeof input === "string" ? input : input.toString(),
    "http://localhost",
  );
  const pattern = url.pathname
    .replace(
      /^\/api\/conversations\/[^/]+\/messages$/,
      "/api/conversations/:id/messages",
    )
    .replace(/^\/api\/runs\/[^/]+\/events$/, "/api/runs/:id/events")
    .replace(/^\/api\/runs\/[^/]+\/cancel$/, "/api/runs/:id/cancel");
  return `${method} ${pattern}`;
}

function renderScreen(
  props: {
    initialAgent?: string | null;
    initialConversation?: string | null;
    initialRun?: string | null;
  } = {},
  overrides: Routes = {},
) {
  const routes = { ...baseRoutes(), ...overrides };
  const calls: Array<{ key: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const key = routeKey(input, method);
      calls.push({ key, init });
      const handler = routes[key];
      return (
        handler?.(input, init) ??
        new Response(
          JSON.stringify({
            error: { code: "unknown", message: "no route" },
          }),
          { status: 500 },
        )
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={messages}>
        <ChatScreen
          initialAgent={props.initialAgent ?? null}
          initialConversation={props.initialConversation ?? null}
          initialRun={props.initialRun ?? null}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatScreen", () => {
  it("renders the streamed answer in order and clears the spinner", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen({ initialAgent: AGENT_ID });

    await user.type(screen.getByLabelText("Mensaje"), "¿Cómo estás?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => {
      expect(screen.queryByText("Pensando…")).toBeNull();
    });
    // The optimistic bubble steps aside once the history carries the message.
    await waitFor(() => {
      expect(screen.getAllByText("¿Cómo estás?")).toHaveLength(1);
    });
    expect(screen.getAllByText("Hola")).toHaveLength(1);
    expect(calls.some((call) => call.key === "POST /api/runs")).toBe(true);
    expect(calls.some((call) => call.key === "POST /api/conversations")).toBe(
      true,
    );
  });

  it("keeps the agent and conversation in the address so a reload rehydrates", async () => {
    const user = userEvent.setup();
    renderScreen({ initialAgent: AGENT_ID });

    await user.type(screen.getByLabelText("Mensaje"), "¿Cómo estás?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    // The reload (S6) rebuilds the screen from the URL: without the agent
    // there is no transcript to rehydrate, and the answer is lost.
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("agent")).toBe(AGENT_ID);
      expect(params.get("conversation")).toBe(CONVERSATION_ID);
      expect(params.get("run")).toBe(RUN_ID);
    });
  });

  it("rehydrates a replayed run without duplicating its text", async () => {
    const { calls } = renderScreen({
      initialAgent: AGENT_ID,
      initialConversation: CONVERSATION_ID,
      initialRun: RUN_ID,
    });

    // The replay rebuilds the answer; the history endpoint already carries
    // the final assistant message, so "Hola" must exist exactly once.
    await waitFor(() => {
      expect(screen.queryByText("Pensando…")).toBeNull();
    });
    expect(screen.getAllByText("Hola")).toHaveLength(1);
    expect(screen.getByText("¿Cómo estás?")).toBeDefined();
    expect(calls.some((call) => call.key === "GET /api/runs/:id/events")).toBe(
      true,
    );
  });

  it("shows a run failure as a sentence and clears the spinner", async () => {
    renderScreen(
      {
        initialAgent: AGENT_ID,
        initialConversation: CONVERSATION_ID,
        initialRun: RUN_ID,
      },
      {
        "GET /api/runs/:id/events": () =>
          sseResponse([
            frame(1, started),
            frame(2, {
              type: "run.failed",
              code: "invalid_api_key",
              message: "La key de este proveedor no funciona.",
            }),
          ]),
        "GET /api/conversations/:id/messages": () =>
          new Response(
            JSON.stringify({ messages: [userMessage], nextCursor: null }),
            { status: 200 },
          ),
      },
    );

    await screen.findByRole("alert");
    expect(
      screen.getByText("La key de este proveedor no funciona."),
    ).toBeDefined();
    expect(screen.queryByText("Pensando…")).toBeNull();
  });

  it("marks a cancelled run and keeps the text shown so far", async () => {
    renderScreen(
      {
        initialAgent: AGENT_ID,
        initialConversation: CONVERSATION_ID,
        initialRun: RUN_ID,
      },
      {
        "GET /api/runs/:id/events": () =>
          sseResponse([
            frame(1, started),
            frame(2, delta("Hol")),
            frame(3, { type: "run.cancelled" }),
          ]),
        "GET /api/conversations/:id/messages": () =>
          new Response(
            JSON.stringify({ messages: [userMessage], nextCursor: null }),
            { status: 200 },
          ),
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Cortaste la respuesta.")).toBeDefined();
    });
    expect(screen.getByText("Hol")).toBeDefined();
    expect(screen.queryByText("Pensando…")).toBeNull();
  });

  it("asks the API to cancel the run while the answer is streaming", async () => {
    const user = userEvent.setup();
    const { calls } = renderScreen(
      { initialAgent: AGENT_ID },
      { "POST /api/runs": () => sseResponse([frame(1, started)], true) },
    );

    await user.type(screen.getByLabelText("Mensaje"), "¿Cómo estás?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Pensando…");
    await user.click(screen.getByRole("button", { name: "Cortar" }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.key === "POST /api/runs/:id/cancel"),
      ).toBe(true);
    });
  });
});
