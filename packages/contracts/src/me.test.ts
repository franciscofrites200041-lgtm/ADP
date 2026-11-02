import { describe, expect, it } from "vitest";

import { meResponseSchema } from "./me.ts";

const valid = {
  user: {
    id: "0190a5f2-7b1c-7d3e-8f00-0000000000a1",
    name: "Ana",
    email: "ana@example.com",
  },
  workspace: { id: "0190a5f2-7b1c-7d3e-8f00-0000000000b1" },
};

describe("me response", () => {
  it("accepts the API's answer", () => {
    expect(meResponseSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a body without a workspace, so the UI cannot treat it as signed in", () => {
    expect(meResponseSchema.safeParse({ user: valid.user }).success).toBe(
      false,
    );
    expect(meResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects extra fields instead of passing them along", () => {
    expect(
      meResponseSchema.safeParse({ ...valid, apiKey: "sk-nope" }).success,
    ).toBe(false);
  });
});
