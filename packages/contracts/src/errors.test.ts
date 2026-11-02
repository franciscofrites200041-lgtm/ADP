import { describe, expect, it } from "vitest";

import { errorBodySchema, errorCodeSchema } from "./errors.ts";

describe("error codes", () => {
  it("accepts forbidden, used when the request origin does not match (S10)", () => {
    expect(errorCodeSchema.parse("forbidden")).toBe("forbidden");
  });

  it("rejects a code outside the catalog", () => {
    expect(errorCodeSchema.safeParse("teapot").success).toBe(false);
  });
});

describe("error codes", () => {
  it("include unknown for unexpected failures", () => {
    expect(errorCodeSchema.parse("unknown")).toBe("unknown");
    expect(
      errorBodySchema.safeParse({
        error: { code: "unknown", message: "Algo salió mal." },
      }).success,
    ).toBe(true);
  });

  it("reject codes outside the catalog", () => {
    expect(errorCodeSchema.safeParse("internal_error").success).toBe(false);
  });
});
