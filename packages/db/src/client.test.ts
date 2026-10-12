import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgres, drizzle } = vi.hoisted(() => ({
  postgres: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle }));

import { createDbClient } from "./client.js";

describe("createDbClient", () => {
  beforeEach(() => {
    postgres.mockReset();
    drizzle.mockReset();
    delete process.env.DATABASE_URL;
  });

  it("injects the explicit URL into the postgres driver", () => {
    const sql = { end: vi.fn() };
    postgres.mockReturnValue(sql);
    drizzle.mockReturnValue({ $client: sql });

    createDbClient("postgres://user:pass@localhost:5432/middleware");

    expect(postgres).toHaveBeenCalledTimes(1);
    expect(postgres).toHaveBeenCalledWith(
      "postgres://user:pass@localhost:5432/middleware",
    );
    expect(drizzle).toHaveBeenCalledTimes(1);
    expect(drizzle).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ schema: expect.any(Object) }),
    );
  });

  it("never reads DATABASE_URL from the environment", () => {
    process.env.DATABASE_URL = "postgres://from-env/should-not-be-used";
    const sql = { end: vi.fn() };
    postgres.mockReturnValue(sql);
    drizzle.mockReturnValue({ $client: sql });

    createDbClient("postgres://explicit/url");

    expect(postgres).toHaveBeenCalledWith("postgres://explicit/url");
    expect(postgres).not.toHaveBeenCalledWith(
      "postgres://from-env/should-not-be-used",
    );
  });
});
