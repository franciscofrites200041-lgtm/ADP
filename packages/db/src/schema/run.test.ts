import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { run } from "./run.ts";

const config = getTableConfig(run);

function column(name: string) {
  return config.columns.find((candidate) => candidate.name === name);
}

/** Execution engine columns (§5): turns, checkpoint and the liveness lease. */
describe("run execution engine columns (§5)", () => {
  it("defaults turns_completed to 0 and keeps it non-null", () => {
    const turns = column("turns_completed");

    expect(turns?.columnType).toBe("PgInteger");
    expect(turns?.notNull).toBe(true);
    expect(turns?.hasDefault).toBe(true);
  });

  it("keeps checkpoint jsonb and nullable", () => {
    const checkpoint = column("checkpoint");

    expect(checkpoint?.columnType).toBe("PgJsonb");
    expect(checkpoint?.notNull).toBe(false);
  });

  it("keeps lease_until a nullable timestamptz", () => {
    const lease = column("lease_until");

    expect(lease?.columnType).toBe("PgTimestamp");
    expect(lease?.notNull).toBe(false);
    expect((lease as unknown as { withTimezone: boolean }).withTimezone).toBe(
      true,
    );
  });

  it("indexes lease_until for finding orphaned runs", () => {
    const leaseIndex = config.indexes.find(
      (candidate) => candidate.config.name === "run_lease_until_idx",
    );

    expect(leaseIndex).toBeDefined();
    expect(
      leaseIndex?.config.columns.map((candidate) =>
        typeof candidate === "string"
          ? candidate
          : "name" in candidate
            ? (candidate.name ?? "")
            : "",
      ),
    ).toEqual(["lease_until"]);
  });
});
