import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createKeyring, generateDek, wrapDek } from "./envelope.ts";
import type { StoredWorkspaceKey } from "./rotate-workspace-keys.ts";
import { runRotateCli } from "./rotate-workspace-keys-cli.ts";

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const env = {
  DATABASE_URL: "postgres://user:db-password@127.0.0.1:1/x",
  MW_MASTER_KEY: newKek.toString("base64"),
  MW_MASTER_KEY_VERSION: "v2",
  MW_MASTER_KEY_PREVIOUS: `v1:${oldKek.toString("base64")}`,
};

function harness(rows: StoredWorkspaceKey[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const updates: unknown[] = [];
  let closed = false;
  const io = {
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  };
  const openStore = async (url: string) => {
    expect(url).toBe(env.DATABASE_URL);
    return {
      store: {
        list: async () => rows,
        update: async (_e: unknown, i: unknown) => {
          updates.push(i);
          return true;
        },
      },
      close: async () => {
        closed = true;
      },
    };
  };
  return { io, out, err, updates, openStore, isClosed: () => closed };
}

describe("runRotateCli", () => {
  it("prints help without touching env or database", async () => {
    const h = harness();
    const code = await runRotateCli(["--help"], {}, h.io, h.openStore);
    expect(code).toBe(0);
    expect(h.out.join("")).toContain("MW_MASTER_KEY_PREVIOUS");
    expect(h.out.join("")).toContain("DATABASE_URL");
  });

  it("rejects arguments so key material cannot travel in argv", async () => {
    const h = harness();
    const code = await runRotateCli(["--key", "abc"], env, h.io, h.openStore);
    expect(code).toBe(2);
    expect(h.err.join("")).not.toContain("abc");
  });

  it("rotates and prints only counts", async () => {
    const oldRing = createKeyring({ version: "v1", key: oldKek });
    const row = {
      workspaceId,
      ...wrapDek(oldRing, workspaceId, generateDek()),
    };
    const h = harness([row]);
    const code = await runRotateCli([], env, h.io, h.openStore);
    expect(code).toBe(0);
    expect(JSON.parse(h.out.join(""))).toEqual({
      scanned: 1,
      rotated: 1,
      skipped: 0,
    });
    expect(h.updates).toHaveLength(1);
    expect(h.isClosed()).toBe(true);
  });

  it("fails with a generic message that never echoes secrets", async () => {
    const h = harness();
    const bad = { ...env, MW_MASTER_KEY: "not-a-key-super-secret" };
    const code = await runRotateCli([], bad, h.io, h.openStore);
    expect(code).toBe(1);
    const all = h.err.join("") + h.out.join("");
    expect(all).not.toContain("super-secret");
    expect(all).not.toContain("db-password");
  });

  it("reports a missing or malformed DATABASE_URL with its own code", async () => {
    const { DATABASE_URL: _omit, ...missing } = env;
    for (const bad of [
      missing,
      { ...env, DATABASE_URL: "   " },
      { ...env, DATABASE_URL: "not a url" },
    ]) {
      const h = harness();
      expect(await runRotateCli([], bad, h.io, h.openStore)).toBe(1);
      expect(h.err.join("")).toContain("INVALID_DATABASE_URL");
      expect(h.err.join("")).not.toContain("INVALID_KEY");
    }
  });
});
