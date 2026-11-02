import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { AliasTakenError, type StoredCredential } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createCredentialRepo } from "./credential-repo.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("credential repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const repo = createCredentialRepo(drizzle(sql, { schema }));
  const created: string[] = [];
  const workspace = () => {
    const id = randomUUID();
    created.push(id);
    return id;
  };
  const stored = (
    workspaceId: string,
    alias: string,
    overrides: Partial<StoredCredential> = {},
  ): StoredCredential => ({
    id: createId(),
    workspaceId,
    providerId: "openai",
    alias,
    last4: "abcd",
    baseUrl: null,
    status: "unchecked",
    createdBy: randomUUID(),
    archivedAt: null,
    secret: { ciphertext: "ct", iv: "iv", authTag: "tag", kekVersion: "v1" },
    ...overrides,
  });

  afterAll(async () => {
    if (created.length)
      await sql`delete from provider_credential where workspace_id in ${sql(created)}`;
    await sql.end();
  });

  it("inserts and reads back without the secret", async () => {
    const ws = workspace();
    const { secret, ...expected } = stored(ws, "main");
    const inserted = await repo.insert(ws, { ...expected, secret });
    expect(inserted).toEqual(expected);
    expect(await repo.findById(ws, expected.id)).toEqual(expected);
    const [row] = await sql`
      select ciphertext, iv, auth_tag, kek_version from provider_credential
      where workspace_id = ${ws} and id = ${expected.id}`;
    expect(row).toEqual({
      ciphertext: "ct",
      iv: "iv",
      auth_tag: "tag",
      kek_version: "v1",
    });
  });

  it("lists only the workspace's active credentials, newest first", async () => {
    const a = workspace();
    const b = workspace();
    const ids = [];
    for (const alias of ["one", "two", "three"]) {
      ids.push((await repo.insert(a, stored(a, alias))).id);
    }
    const other = await repo.insert(b, stored(b, "one"));
    const archived = await repo.insert(a, stored(a, "gone"));
    await repo.archive(a, archived.id, new Date());

    expect((await repo.list(a)).map((c) => c.id)).toEqual(ids.reverse());
    expect((await repo.list(b)).map((c) => c.id)).toEqual([other.id]);
    expect(await repo.list(workspace())).toEqual([]);
  });

  it("treats another workspace's credential as missing (cross-tenant)", async () => {
    const a = workspace();
    const b = workspace();
    const own = await repo.insert(a, stored(a, "main"));

    expect(await repo.findById(b, own.id)).toBeNull();
    expect(await repo.rename(b, own.id, "stolen")).toBeNull();
    expect(await repo.archive(b, own.id, new Date())).toBeNull();
    expect(await repo.findById(a, own.id)).toEqual(own);
    expect(await repo.findById(a, randomUUID())).toBeNull();
  });

  it("renames and archives within the workspace", async () => {
    const ws = workspace();
    const own = await repo.insert(ws, stored(ws, "main"));
    expect(await repo.rename(ws, own.id, "backup")).toEqual({
      ...own,
      alias: "backup",
    });
    const at = new Date("2026-11-02T12:00:00.000Z");
    expect(await repo.archive(ws, own.id, at)).toEqual({
      ...own,
      alias: "backup",
      archivedAt: at,
    });
    expect(await repo.findById(ws, own.id)).toBeNull();
    expect(await repo.rename(ws, own.id, "again")).toBeNull();
    expect(await repo.archive(ws, own.id, new Date())).toBeNull();
  });

  it("rejects a duplicate active alias and frees it on archive", async () => {
    const ws = workspace();
    const first = await repo.insert(ws, stored(ws, "main"));
    const second = await repo.insert(ws, stored(ws, "spare"));

    await expect(repo.insert(ws, stored(ws, "main"))).rejects.toThrow(
      AliasTakenError,
    );
    await expect(repo.rename(ws, second.id, "main")).rejects.toThrow(
      AliasTakenError,
    );
    await repo.archive(ws, first.id, new Date());
    const reused = await repo.insert(ws, stored(ws, "main"));
    expect(await repo.findById(ws, reused.id)).toEqual(reused);
  });

  it("turns other database errors into one that carries no row data (S2)", async () => {
    const ws = workspace();
    const markers = [
      "ciphertext-marker-xyz",
      "iv-marker-xyz",
      "tag-marker-xyz",
    ];
    const invalid = stored(ws, "main", {
      baseUrl: "https://example.com",
      secret: {
        ciphertext: markers[0] ?? "",
        iv: markers[1] ?? "",
        authTag: markers[2] ?? "",
        kekVersion: "v1",
      },
    });
    const error = await repo.insert(ws, invalid).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(AliasTakenError);
    expect(error).toMatchObject({
      code: "PERSISTENCE_FAILED",
      sqlState: "23514",
    });
    const printed = `${String(error)} ${JSON.stringify(error)} ${inspect(error, { depth: 10, showHidden: true })}`;
    for (const marker of markers) expect(printed).not.toContain(marker);
  });
});
