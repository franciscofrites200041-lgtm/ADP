import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "./api-client.ts";

describe("apiErrorMessage", () => {
  it("uses the API message when the body is an error body", () => {
    expect(
      apiErrorMessage(
        { error: { code: "alias_taken", message: "Ese alias ya existe." } },
        "fallback",
      ),
    ).toBe("Ese alias ya existe.");
  });

  it("falls back for anything else", () => {
    expect(apiErrorMessage(null, "Algo salió mal.")).toBe("Algo salió mal.");
    expect(apiErrorMessage({ error: { code: "nope" } }, "x")).toBe("x");
  });
});
