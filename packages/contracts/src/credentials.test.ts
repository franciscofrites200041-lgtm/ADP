import { describe, expect, it } from "vitest";

import {
  createCredentialRequestSchema,
  credentialIdParamSchema,
  credentialListResponseSchema,
  credentialResponseSchema,
  renameCredentialRequestSchema,
} from "./credentials.ts";
import { errorBodySchema } from "./errors.ts";
import { providerCatalog } from "./providers.ts";

const credential = {
  id: "0190a5f2-7b1c-7d3e-8f00-000000000001",
  providerId: "openai",
  alias: "Personal",
  last4: "a1b2",
  status: "unchecked",
  baseUrl: null,
};

describe("provider catalog", () => {
  it("needs a base URL only for openai-compatible", () => {
    const withBaseUrl = providerCatalog.filter(
      (provider) => provider.needsBaseUrl,
    );
    expect(withBaseUrl.map((provider) => provider.id)).toEqual([
      "openai-compatible",
    ]);
    expect(providerCatalog).toHaveLength(6);
  });
});

describe("create credential request", () => {
  const valid = {
    providerId: "anthropic",
    alias: "Work",
    apiKey: "sk-test-12345678",
  };

  it("accepts a key for a catalog provider", () => {
    expect(createCredentialRequestSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an https base URL for openai-compatible", () => {
    const input = {
      ...valid,
      providerId: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
    };
    expect(createCredentialRequestSchema.safeParse(input).success).toBe(true);
  });

  it("requires a base URL for openai-compatible", () => {
    const input = { ...valid, providerId: "openai-compatible" };
    expect(createCredentialRequestSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a base URL for any other provider", () => {
    const input = { ...valid, baseUrl: "https://llm.example.com/v1" };
    expect(createCredentialRequestSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an http base URL", () => {
    const input = {
      ...valid,
      providerId: "openai-compatible",
      baseUrl: "http://llm.example.com/v1",
    };
    expect(createCredentialRequestSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["an empty alias", { alias: "   " }],
    ["a key shorter than 8 characters", { apiKey: "sk-1234" }],
    ["an unknown provider", { providerId: "acme" }],
  ])("rejects %s", (_case, override) => {
    expect(
      createCredentialRequestSchema.safeParse({ ...valid, ...override })
        .success,
    ).toBe(false);
  });
});

describe("rename and id param", () => {
  it("accepts a new alias and rejects an empty one", () => {
    expect(renameCredentialRequestSchema.parse({ alias: " Main " })).toEqual({
      alias: "Main",
    });
    expect(renameCredentialRequestSchema.safeParse({ alias: "" }).success).toBe(
      false,
    );
  });

  it("accepts only uuid ids", () => {
    expect(
      credentialIdParamSchema.safeParse({ id: credential.id }).success,
    ).toBe(true);
    expect(credentialIdParamSchema.safeParse({ id: "1" }).success).toBe(false);
  });
});

describe("credential response (S2)", () => {
  it("accepts the public view and a list of it", () => {
    expect(credentialResponseSchema.parse(credential)).toEqual(credential);
    expect(
      credentialListResponseSchema.parse({ credentials: [credential] }),
    ).toEqual({
      credentials: [credential],
    });
  });

  it.each(["apiKey", "ciphertext", "iv", "authTag"])(
    "rejects an object carrying %s",
    (field) => {
      expect(
        credentialResponseSchema.safeParse({ ...credential, [field]: "x" })
          .success,
      ).toBe(false);
    },
  );

  it("declares no secret-like field", () => {
    for (const field of Object.keys(credentialResponseSchema.shape)) {
      expect(field).not.toMatch(/key|cipher|^iv$|tag|secret/i);
    }
  });
});

describe("error body", () => {
  it("accepts a catalog code and rejects an unknown one", () => {
    const body = {
      error: { code: "alias_taken", message: "Ese alias ya existe." },
    };
    expect(errorBodySchema.parse(body)).toEqual(body);
    expect(
      errorBodySchema.safeParse({ error: { code: "boom", message: "x" } })
        .success,
    ).toBe(false);
  });
});
