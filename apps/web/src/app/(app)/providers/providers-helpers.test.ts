import { describe, expect, it } from "vitest";
import { parseCredentialList } from "../../../shared/credentials.ts";
import {
  maskLast4,
  needsBaseUrl,
  providerMonogram,
} from "./providers-helpers.ts";

const credential = {
  id: "0190a5f2-7b1c-7d3e-8f00-000000000001",
  providerId: "openai",
  alias: "Personal",
  last4: "9f3k",
  status: "unchecked",
  baseUrl: null,
};

describe("maskLast4", () => {
  it("shows only the last four characters behind dots", () => {
    expect(maskLast4("9f3k")).toBe("····9f3k");
  });
});

describe("needsBaseUrl", () => {
  it("is true only for openai-compatible", () => {
    expect(needsBaseUrl("openai-compatible")).toBe(true);
    expect(needsBaseUrl("openai")).toBe(false);
    expect(needsBaseUrl("anthropic")).toBe(false);
  });
});

describe("providerMonogram", () => {
  it("uses the first letter of the catalog label", () => {
    expect(providerMonogram("openai")).toBe("O");
  });
});

describe("parseCredentialList", () => {
  it("accepts the API's list body", () => {
    expect(parseCredentialList({ credentials: [credential] })).toHaveLength(1);
  });

  it("rejects a body that carries the key or the ciphertext (S2)", () => {
    for (const leaked of [
      { ...credential, apiKey: "sk-live-123" },
      { ...credential, ciphertext: "abc" },
    ]) {
      expect(() => parseCredentialList({ credentials: [leaked] })).toThrow();
    }
  });
});
