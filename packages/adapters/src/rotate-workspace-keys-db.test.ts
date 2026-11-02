import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createKeyring,
  decryptSecret,
  encryptSecret,
  generateDek,
  rewrapDek,
  unwrapDek,
  wrapDek,
} from "./envelope.ts";
import { rotateWorkspaceKeys } from "./rotate-workspace-keys.ts";
import { createPostgresWorkspaceKeyStore } from "./rotate-workspace-keys-db.ts";

// Disposable database only: refuse anything else before touching it.
const url =
  process.env.DATABASE_URL_TEST ??
  "postgres://mw_test@127.0.0.1:55432/middleware_test";
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/middleware_test") {
  throw new Error("Refusing to run against a non-disposable database");
}

// workspace_key is not migrated in the test database: use a private schema
// (same columns as packages/db) created and dropped by this file only.
const schema = `wp06_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(url, { max: 1 });
const sql = postgres(url, { max: 2, connection: { search_path: schema } });
const ids = [randomUUID(), randomUUID(), randomUUID()] as const;
const [idA, idB, idC] = ids;
const oldKek = randomBytes(32);
const v1 = createKeyring({ version: "v1", key: oldKek });
const v2 = createKeyring({
  version: "v2",
  key: randomBytes(32),
  previous: { v1: oldKek },
});
const rowOf = async (id: string) => {
  const [row] = await sql<
    { kek_version: string; wrapped_dek: string; rotated_at: Date | null }[]
  >`select kek_version, wrapped_dek, rotated_at from workspace_key where workspace_id = ${id}`;
  return row;
};
const insert = (id: string, w: { kekVersion: string; wrappedDek: string }) =>
  sql`insert into workspace_key (workspace_id, kek_version, wrapped_dek) values (${id}, ${w.kekVersion}, ${w.wrappedDek})`;

describe.skipIf(!process.env.DATABASE_URL_TEST)(
  "postgres workspace key store",
  () => {
    const dekA = generateDek();
    const aad = { workspaceId: idA, table: "provider_credential", id: "c1" };
    const secret = encryptSecret(dekA, aad, "test-secret-value");

    beforeAll(async () => {
      await admin.unsafe(`create schema "${schema}"`);
      await admin.unsafe(`create table "${schema}".workspace_key (
      workspace_id uuid primary key not null,
      kek_version varchar(64) not null,
      wrapped_dek text not null,
      created_at timestamptz not null default now(),
      rotated_at timestamptz)`);
      await insert(idA, wrapDek(v1, idA, dekA));
      await insert(idB, wrapDek(v1, idB, generateDek()));
      await insert(idC, wrapDek(v2, idC, generateDek()));
    });
    afterAll(async () => {
      await sql.end();
      await admin.unsafe(`drop schema "${schema}" cascade`);
      await admin.end();
    });

    it("rotates scoped rows and the rewrapped DEK still decrypts existing secrets", async () => {
      const store = createPostgresWorkspaceKeyStore(sql, { workspaceIds: ids });
      const rotatedAt = new Date("2026-10-29T15:00:00.000Z");

      const result = await rotateWorkspaceKeys({ ring: v2, store, rotatedAt });

      expect(result).toEqual({ scanned: 3, rotated: 2, skipped: 1 });
      const row = await rowOf(idA);
      expect(row?.kek_version).toBe("v2");
      expect(row?.rotated_at).toEqual(rotatedAt);
      const dek = unwrapDek(v2, idA, {
        kekVersion: "v2",
        wrappedDek: row?.wrapped_dek ?? "",
      });
      expect(decryptSecret(dek, aad, secret)).toBe("test-secret-value");
      expect((await rowOf(idC))?.rotated_at).toBeNull();
    });

    it("rotates an isolated row in the migrated public workspace_key table", async () => {
      const id = randomUUID();
      const dek = generateDek();
      const wrapped = wrapDek(v1, id, dek);
      const aad = { workspaceId: id, table: "provider_credential", id: "test" };
      const secret = encryptSecret(dek, aad, "test-secret");
      await admin`insert into public.workspace_key (workspace_id, kek_version, wrapped_dek) values (${id}, ${wrapped.kekVersion}, ${wrapped.wrappedDek})`;
      try {
        const store = createPostgresWorkspaceKeyStore(admin, {
          workspaceIds: [id],
        });
        expect(
          await rotateWorkspaceKeys({ ring: v2, store, rotatedAt: new Date() }),
        ).toEqual({ scanned: 1, rotated: 1, skipped: 0 });
        const [row] = await store.list();
        if (!row) throw new Error("row missing");
        expect(decryptSecret(unwrapDek(v2, id, row), aad, secret)).toBe(
          "test-secret",
        );
      } finally {
        await admin`delete from public.workspace_key where workspace_id = ${id}`;
      }
    });

    it("does not list rows outside the requested workspaces", async () => {
      const store = createPostgresWorkspaceKeyStore(sql, {
        workspaceIds: [idB],
      });
      expect((await store.list()).map((r) => r.workspaceId)).toEqual([idB]);
    });

    it("never overwrites a DEK changed after it was read", async () => {
      const id = randomUUID();
      await insert(id, wrapDek(v1, id, generateDek()));
      try {
        const store = createPostgresWorkspaceKeyStore(sql, {
          workspaceIds: [id],
        });
        const [stale] = await store.list();
        if (!stale) throw new Error("row missing");
        const newer = wrapDek(v2, id, generateDek());
        await sql`update workspace_key set kek_version = ${newer.kekVersion}, wrapped_dek = ${newer.wrappedDek} where workspace_id = ${id}`;

        const mine = rewrapWith(stale, id);
        const ok = await store.update(stale, {
          workspaceId: id,
          ...mine,
          rotatedAt: new Date(),
        });

        expect(ok).toBe(false);
        expect((await rowOf(id))?.wrapped_dek).toBe(newer.wrappedDek);
      } finally {
        await sql`delete from workspace_key where workspace_id = ${id}`;
      }
    });

    it("compares the exact ciphertext, not only the KEK version", async () => {
      const id = randomUUID();
      await insert(id, wrapDek(v1, id, generateDek()));
      try {
        const store = createPostgresWorkspaceKeyStore(sql, {
          workspaceIds: [id],
        });
        const [stale] = await store.list();
        if (!stale) throw new Error("row missing");
        const sameVersion = wrapDek(v1, id, generateDek());
        await sql`update workspace_key set wrapped_dek = ${sameVersion.wrappedDek} where workspace_id = ${id}`;

        const ok = await store.update(stale, {
          workspaceId: id,
          ...rewrapWith(stale, id),
          rotatedAt: new Date(),
        });

        expect(ok).toBe(false);
        const row = await rowOf(id);
        expect(row?.kek_version).toBe("v1");
        expect(row?.wrapped_dek).toBe(sameVersion.wrappedDek);
      } finally {
        await sql`delete from workspace_key where workspace_id = ${id}`;
      }
    });

    it("fails rotation without leaking key material when a row changes mid-run", async () => {
      const id = randomUUID();
      await insert(id, wrapDek(v1, id, generateDek()));
      try {
        const real = createPostgresWorkspaceKeyStore(sql, {
          workspaceIds: [id],
        });
        const newer = wrapDek(v2, id, generateDek());
        const store = {
          ...real,
          list: async () => {
            const rows = await real.list();
            await sql`update workspace_key set kek_version = ${newer.kekVersion}, wrapped_dek = ${newer.wrappedDek} where workspace_id = ${id}`;
            return rows;
          },
        };

        const err = await rotateWorkspaceKeys({
          ring: v2,
          store,
          rotatedAt: new Date(),
        }).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect(String((err as Error).message)).not.toContain(newer.wrappedDek);
        expect((await rowOf(id))?.wrapped_dek).toBe(newer.wrappedDek);
      } finally {
        await sql`delete from workspace_key where workspace_id = ${id}`;
      }
    });
  },
);

function rewrapWith(
  row: { kekVersion: string; wrappedDek: string },
  id: string,
) {
  return rewrapDek(v2, id, row);
}
