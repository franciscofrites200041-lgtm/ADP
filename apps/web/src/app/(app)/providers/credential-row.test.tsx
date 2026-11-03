// @vitest-environment jsdom
import type {
  CredentialResponse,
  CredentialTestResponse,
} from "@middleware/contracts";
import type { UseMutationResult } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "../../../messages.ts";
import { CredentialRow } from "./credential-row.tsx";

const credential: CredentialResponse = {
  id: "0190a5f2-0000-7000-8000-000000000001",
  providerId: "openai",
  alias: "Personal",
  last4: "9f3k",
  status: "unchecked",
  baseUrl: null,
};

/** A mutation double: idle unless a test says otherwise. */
function idle<TData, TVars>(
  overrides: { data?: TData; variables?: TVars; isPending?: boolean } = {},
): UseMutationResult<TData, Error, TVars> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: overrides.isPending ?? false,
    isIdle: true,
    isError: false,
    isSuccess: false,
    status: "idle",
    data: overrides.data,
    variables: overrides.variables,
    error: null,
  } as unknown as UseMutationResult<TData, Error, TVars>;
}

function renderRow(
  test: UseMutationResult<CredentialTestResponse, Error, { id: string }> = idle<
    CredentialTestResponse,
    { id: string }
  >(),
) {
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <CredentialRow
        credential={credential}
        rename={idle()}
        archive={idle()}
        test={test}
      />
    </NextIntlClientProvider>,
  );
  return { test };
}

afterEach(cleanup);

describe("CredentialRow", () => {
  it("shows the stored status and offers to test the key", () => {
    renderRow();

    expect(screen.getByText("Sin probar")).toBeDefined();
    expect(screen.getByRole("button", { name: "Probar" })).toBeDefined();
  });

  it("tells the user why a key failed, in Spanish", () => {
    renderRow(
      idle<CredentialTestResponse, { id: string }>({
        data: { status: "invalid", code: "invalid_key" },
        variables: { id: credential.id },
      }),
    );

    expect(screen.getByRole("status").textContent).toBe(
      "El proveedor rechazó esta key.",
    );
  });

  it("tests only the row it belongs to", async () => {
    const { test } = renderRow();

    await userEvent.click(screen.getByRole("button", { name: "Probar" }));

    expect(test.mutate).toHaveBeenCalledWith({ id: credential.id });
  });
});
