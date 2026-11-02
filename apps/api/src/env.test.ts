import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { readEnv } from "./env.ts";

// Provider keys, DATABASE_URL and the master key: see container.test.ts.
const valid = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3001",
  SMTP_URL: "smtp://user:pass@localhost:1025",
  MAIL_FROM: "Middleware <no-reply@localhost>",
};

describe("readEnv", () => {
  it("returns the validated variables, with the defaults applied", () => {
    expect(readEnv(valid)).toEqual({ ...valid, MW_SHUTDOWN_GRACE_SECONDS: 60 });
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

  it("defaults the shutdown grace to 60 seconds and coerces a given value", () => {
    expect(readEnv(valid).MW_SHUTDOWN_GRACE_SECONDS).toBe(60);
    expect(
      readEnv({ ...valid, MW_SHUTDOWN_GRACE_SECONDS: "15" })
        .MW_SHUTDOWN_GRACE_SECONDS,
    ).toBe(15);
  });

  it("rejects a shutdown grace that is zero, negative or not a number", () => {
    for (const value of ["0", "-5", "soon", "1.5"]) {
      expect(() =>
        readEnv({ ...valid, MW_SHUTDOWN_GRACE_SECONDS: value }),
      ).toThrow(ZodError);
    }
  });
});
