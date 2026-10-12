import { describe, expect, it } from "vitest";

import { createId } from "./id.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createId", () => {
  it("returns a valid UUIDv7", () => {
    expect(createId()).toMatch(UUID_V7_PATTERN);
  });

  it("returns distinct values on every call", () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => createId()));
    expect(ids.size).toBe(1_000);
  });
});
