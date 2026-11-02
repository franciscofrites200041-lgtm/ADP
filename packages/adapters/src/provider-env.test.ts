import { describe, expect, it } from "vitest";

import {
  assertNoProviderKeys,
  PROVIDER_CREDENTIAL_ENV_VARS,
  ProviderKeyEnvError,
} from "./provider-env.ts";

describe("assertNoProviderKeys", () => {
  it("passes on a clean environment", () => {
    expect(() => assertNoProviderKeys({ PATH: "/bin" })).not.toThrow();
  });

  it("blocks OPENAI_API_KEY and names it without leaking the value", () => {
    try {
      assertNoProviderKeys({ OPENAI_API_KEY: "sk-leak-me" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderKeyEnvError);
      expect((e as ProviderKeyEnvError).vars).toEqual(["OPENAI_API_KEY"]);
      expect(String(e)).not.toContain("sk-leak-me");
    }
  });

  it("blocks every documented variable", () => {
    for (const name of PROVIDER_CREDENTIAL_ENV_VARS) {
      expect(() => assertNoProviderKeys({ [name]: "x" })).toThrow(
        ProviderKeyEnvError,
      );
    }
  });

  it("covers the master-document names and pi-ai extras", () => {
    for (const name of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "XAI_API_KEY",
      "OPENROUTER_API_KEY",
      "AZURE_OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "COPILOT_GITHUB_TOKEN",
      "HF_TOKEN",
    ]) {
      expect(PROVIDER_CREDENTIAL_ENV_VARS).toContain(name);
    }
  });

  it("blocks on presence even when the value is empty", () => {
    expect(() => assertNoProviderKeys({ OPENAI_API_KEY: "" })).toThrow(
      ProviderKeyEnvError,
    );
  });
});
