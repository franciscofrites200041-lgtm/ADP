import { describe, expect, it } from "vitest";

import { errorBodySchema, errorCodeSchema } from "./errors.ts";

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
