import { sql } from "drizzle-orm";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { DbClient } from "./client.js";
import { type Pingable, ping } from "./ping.js";

describe("ping", () => {
  it("accepts the typed client where a Pingable is expected", () => {
    expectTypeOf<DbClient>().toExtend<Pingable>();
  });

  it("returns true when the database responds", async () => {
    const execute = vi.fn(async () => undefined);

    await expect(ping({ execute })).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(sql`select 1`);
  });

  it("returns false when the database is unreachable", async () => {
    const execute = vi.fn(async () => {
      throw new Error("connection refused");
    });

    await expect(ping({ execute })).resolves.toBe(false);
  });
});
