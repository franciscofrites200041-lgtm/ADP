import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { CryptoError, createKeyring, wrapDek } from "./envelope.ts";
import { createWorkspaceKeyVault } from "./workspace-key-vault.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("workspace key vault (postgres)", () => {
  const sql = postgres(url ?? "", { max: 10 });
  const ring = createKeyring({ version: "v1", key: randomBytes(32) });
  const vault = createWorkspaceKeyVault(sql, ring);
  const created: string[] = [];
  const fresh = () => {
    const id = randomUUID();
    created.push(id);
    return id;
  };
  const rowOf = async (id: string) =>
    (
      await sql<{ kek_version: string; wrapped_dek: string }[]>`
        select kek_version, wrapped_dek from workspace_key where workspace_id = ${id}`
    )[0];

  afterAll(async () => {
    if (created.length)
      await sql`delete from workspace_key where workspace_id in ${sql(created)}`;
    await sql.end();
  });

  it("concurrent first access returns the one persisted DEK", async () => {
    const id = fresh();
    const deks = await Promise.all(
      Array.from({ length: 8 }, () => vault.getDek(id)),
    );
    for (const d of deks) expect(d.equals(deks[0] as Buffer)).toBe(true);
    const rows =
      await sql`select 1 from workspace_key where workspace_id = ${id}`;
    expect(rows).toHaveLength(1);
    expect(
      (await createWorkspaceKeyVault(sql, ring).getDek(id)).equals(
        deks[0] as Buffer,
      ),
    ).toBe(true);
  });

  it("does not create a workspace key when decrypting without a stored key", async () => {
    const id = fresh();
    await expect(
      vault.decrypt(id, { table: "provider_credential", id: "c1" }, "invalid"),
    ).rejects.toMatchObject({ code: "WORKSPACE_KEY_NOT_FOUND" });
    expect(await rowOf(id)).toBeUndefined();
  });

  it("persists only the wrapped DEK, never the clear one", async () => {
    const id = fresh();
    const dek = await vault.getDek(id);
    const row = await rowOf(id);
    expect(row?.kek_version).toBe("v1");
    expect(row?.wrapped_dek).not.toContain(dek.toString("base64"));
    expect(Buffer.from(row?.wrapped_dek ?? "", "base64").includes(dek)).toBe(
      false,
    );
  });

  it("keeps workspaces isolated and binds secrets to their AAD", async () => {
    const a = fresh();
    const b = fresh();
    expect((await vault.getDek(a)).equals(await vault.getDek(b))).toBe(false);
    const aad = { table: "provider_credential", id: "c1" };
    const sealed = await vault.encrypt(a, aad, "test-secret");
    expect(await vault.decrypt(a, aad, sealed)).toBe("test-secret");
    await expect(vault.decrypt(b, aad, sealed)).rejects.toThrow(CryptoError);
    await expect(
      vault.decrypt(a, { ...aad, id: "c2" }, sealed),
    ).rejects.toThrow(CryptoError);
  });

  it("reads rows wrapped under an older KEK and never returns mismatched data", async () => {
    const id = fresh();
    const old = createKeyring({ version: "v0", key: randomBytes(32) });
    const rotated = createKeyring({
      version: "v1",
      key: randomBytes(32),
      previous: { v0: old.current.key },
    });
    const dek = randomBytes(32);
    const w = wrapDek(old, id, dek);
    await sql`insert into workspace_key (workspace_id, kek_version, wrapped_dek) values (${id}, ${w.kekVersion}, ${w.wrappedDek})`;
    expect(
      (await createWorkspaceKeyVault(sql, rotated).getDek(id)).equals(dek),
    ).toBe(true);
    // Unrelated KEK: fails closed instead of returning anything.
    await expect(
      createWorkspaceKeyVault(
        sql,
        createKeyring({ version: "v0", key: randomBytes(32) }),
      ).getDek(id),
    ).rejects.toThrow(CryptoError);
  });
});
