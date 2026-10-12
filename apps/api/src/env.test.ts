import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { readEnv } from "./env.ts";

describe("readEnv", () => {
  it("returns the validated DATABASE_URL", () => {
    const env = readEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/middleware",
    });

    expect(env.DATABASE_URL).toBe(
      "postgres://user:pass@localhost:5432/middleware",
    );
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => readEnv({})).toThrow(ZodError);
  });

  it("rejects an empty DATABASE_URL", () => {
    expect(() => readEnv({ DATABASE_URL: "" })).toThrow(ZodError);
  });
});
