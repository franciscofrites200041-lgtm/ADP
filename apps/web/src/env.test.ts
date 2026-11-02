import { describe, expect, it } from "vitest";

import { readWebEnv } from "./env.ts";

describe("readWebEnv", () => {
  it("defaults the API URL to the local API", () => {
    expect(readWebEnv({})).toEqual({
      API_INTERNAL_URL: "http://localhost:3001",
    });
  });

  it("accepts an explicit URL", () => {
    expect(readWebEnv({ API_INTERNAL_URL: "http://api:3001" })).toEqual({
      API_INTERNAL_URL: "http://api:3001",
    });
  });

  it.each([["api:3001"], ["not a url"], ["/api"]])(
    "rejects %s at startup instead of failing later",
    (value) => {
      expect(() => readWebEnv({ API_INTERNAL_URL: value })).toThrow();
    },
  );
});
