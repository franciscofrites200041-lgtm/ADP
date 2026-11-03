import { describe, expect, it } from "vitest";

import {
  createCredentialRequestSchema,
  credentialIdParamSchema,
  credentialListResponseSchema,
  credentialResponseSchema,
  credentialTestResponseSchema,
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

describe("alias characters", () => {
  const valid = {
    providerId: "anthropic",
    alias: "Work",
    apiKey: "sk-test-12345678",
  };

  it.each([
    ["a NUL byte", "nul\u0000byte"],
    ["a newline", "two\nlines"],
    ["a tab", "tab\there"],
    ["DEL", "del\u007fchar"],
  ])("rejects %s in create and rename", (_case, alias) => {
    expect(
      createCredentialRequestSchema.safeParse({ ...valid, alias }).success,
    ).toBe(false);
    expect(renameCredentialRequestSchema.safeParse({ alias }).success).toBe(
      false,
    );
  });

  it("keeps accepting accents, emoji and spaces inside the alias", () => {
    const alias = "Producción del equipo 🔑";
    expect(createCredentialRequestSchema.parse({ ...valid, alias }).alias).toBe(
      alias,
    );
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

describe("credentialTestResponseSchema", () => {
  it("accepts a valid probe with no failure code", () => {
    const body = { status: "valid", code: null };
    expect(credentialTestResponseSchema.parse(body)).toEqual(body);
  });

  it("accepts an invalid probe with a known reason", () => {
    const body = { status: "invalid", code: "invalid_key" };
    expect(credentialTestResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects a status without its matching code", () => {
    expect(
      credentialTestResponseSchema.safeParse({
        status: "valid",
        code: "rate_limited",
      }).success,
    ).toBe(false);
    expect(
      credentialTestResponseSchema.safeParse({ status: "invalid", code: null })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown failure code and extra keys", () => {
    expect(
      credentialTestResponseSchema.safeParse({
        status: "invalid",
        code: "boom",
      }).success,
    ).toBe(false);
    expect(
      credentialTestResponseSchema.safeParse({
        status: "valid",
        code: null,
        message: "el contrato no transporta texto de UI",
      }).success,
    ).toBe(false);
  });
});
