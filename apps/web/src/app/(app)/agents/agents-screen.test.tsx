// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { messages } from "../../../messages.ts";
import { AgentsScreen } from "./agents-screen.tsx";

const credential = {
  id: "0190a5f2-0000-7000-8000-000000000001",
  providerId: "openai",
  alias: "Personal",
  last4: "9f3k",
  status: "valid",
  baseUrl: null,
};

const template = {
  id: "0190a5f2-0000-7000-8000-0000000a0001",
  name: "Soporte",
  description: "Responde consultas.",
  instructions: "Atendé consultas.",
  suggestedParams: {},
  suggestedTools: [],
};

const routes: Record<string, unknown> = {
  "/api/agents": { agents: [] },
  "/api/credentials": { credentials: [credential] },
  "/api/agent-templates": { templates: [template] },
};

/** A Request carries its URL in `.url`; a string is the path itself. */
const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
  const path = new URL(urlOf(input), "http://localhost").pathname;
  return new Response(JSON.stringify(routes[path] ?? {}), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={messages}>
        <AgentsScreen />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("AgentsScreen", () => {
  it("renders the template picker and the create form once credentials arrive", async () => {
    renderScreen();

    expect(
      await screen.findByRole("option", { name: "Soporte" }),
    ).toBeDefined();
    expect(screen.getByText("Crear un agente")).toBeDefined();
  });
});
