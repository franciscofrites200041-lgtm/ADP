import { randomBytes } from "node:crypto";
import { ProviderKeyEnvError } from "@middleware/adapters";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { readEnv } from "./env.ts";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/middleware",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3001",
  SMTP_URL: "smtp://user:pass@localhost:1025",
  MAIL_FROM: "Middleware <no-reply@localhost>",
  MW_MASTER_KEY: randomBytes(32).toString("base64"),
  MW_MASTER_KEY_VERSION: "v1",
};

describe("readEnv", () => {
  it("returns the validated variables", () => {
    expect(readEnv(valid)).toEqual(valid);
  });

  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL: _omit, ...env } = valid;
    expect(() => readEnv(env)).toThrow(ZodError);
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => readEnv({ ...valid, DATABASE_URL: "" })).toThrow(ZodError);
  });

  it("rejects a short BETTER_AUTH_SECRET", () => {
    expect(() => readEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      ZodError,
    );
  });

  it("rejects an invalid BETTER_AUTH_URL", () => {
    expect(() => readEnv({ ...valid, BETTER_AUTH_URL: "nope" })).toThrow(
      ZodError,
    );
  });

  it("rejects a missing SMTP_URL", () => {
    const { SMTP_URL: _omit, ...env } = valid;
    expect(() => readEnv(env)).toThrow(ZodError);
  });

  it("refuses to start with OPENAI_API_KEY present", () => {
    expect(() => readEnv({ ...valid, OPENAI_API_KEY: "sk-x" })).toThrow(
      ProviderKeyEnvError,
    );
  });

  it("rejects a master key that is not 32 bytes", () => {
    expect(() => readEnv({ ...valid, MW_MASTER_KEY: "c2hvcnQ=" })).toThrow();
  });
});
