// @vitest-environment jsdom
import type { AgentResponse } from "@middleware/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { messages } from "../../../messages.ts";
import { AgentRow } from "./agent-row.tsx";

const agent: AgentResponse = {
  id: "0190a5f2-0000-7000-8000-000000000001",
  name: "Soporte",
  description: null,
  archivedAt: null,
  currentVersion: {
    id: "0190a5f2-0000-7000-8000-000000000002",
    version: 2,
    instructions: "Atendé consultas.",
    providerId: "openai",
    modelId: "gpt-5",
    credentialId: "0190a5f2-0000-7000-8000-000000000003",
    params: {},
    tools: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  },
};

const idle = () => ({
  mutate: vi.fn(),
  error: null,
  variables: undefined,
  isPending: false,
});

function renderRow() {
  const archive = idle();
  const duplicate = idle();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={messages}>
        <AgentRow
          agent={agent}
          archive={archive}
          duplicate={duplicate}
          onEdit={vi.fn()}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { archive, duplicate };
}

afterEach(cleanup);

describe("AgentRow", () => {
  it("shows which version is current and that the agent is ready", () => {
    renderRow();

    expect(screen.getByText("Versión 2 · gpt-5")).toBeDefined();
    expect(screen.getByText("Listo")).toBeDefined();
  });

  it("offers the history actions", () => {
    renderRow();

    for (const label of ["Editar", "Versiones", "Duplicar", "Archivar"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("archives only the agent of the row", async () => {
    const { archive } = renderRow();

    await userEvent.click(screen.getByRole("button", { name: "Archivar" }));

    expect(archive.mutate).toHaveBeenCalledWith({ id: agent.id });
  });
});
