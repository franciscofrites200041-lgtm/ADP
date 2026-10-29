import type postgres from "postgres";

import {
  CryptoError,
  decryptSecret,
  encryptSecret,
  generateDek,
  type Keyring,
  unwrapDek,
  wrapDek,
} from "./envelope.ts";

type Row = { kek_version: string; wrapped_dek: string };

/**
 * Provisions and reads per-workspace DEKs in `workspace_key`. Only the
 * KEK-wrapped DEK is persisted. First access inserts with ON CONFLICT DO
 * NOTHING and then reads the winning row, so concurrent callers all get the
 * DEK that was actually stored.
 */
export function createWorkspaceKeyVault(sql: postgres.Sql, ring: Keyring) {
  const read = async (workspaceId: string) =>
    (
      await sql<Row[]>`
        select kek_version, wrapped_dek from workspace_key
        where workspace_id = ${workspaceId}`
    )[0];

  const getDek = async (workspaceId: string): Promise<Buffer> => {
    let row = await read(workspaceId);
    if (!row) {
      const w = wrapDek(ring, workspaceId, generateDek());
      await sql`
        insert into workspace_key (workspace_id, kek_version, wrapped_dek)
        values (${workspaceId}, ${w.kekVersion}, ${w.wrappedDek})
        on conflict (workspace_id) do nothing`;
      row = await read(workspaceId);
      if (!row) {
        throw new CryptoError(
          "WORKSPACE_KEY_NOT_FOUND",
          "Workspace key missing after provisioning",
        );
      }
    }
    return unwrapDek(ring, workspaceId, {
      kekVersion: row.kek_version,
      wrappedDek: row.wrapped_dek,
    });
  };

  return {
    getDek,
    encrypt: async (
      workspaceId: string,
      aad: { table: string; id: string },
      plaintext: string,
    ) =>
      encryptSecret(
        await getDek(workspaceId),
        { workspaceId, ...aad },
        plaintext,
      ),
    decrypt: async (
      workspaceId: string,
      aad: { table: string; id: string },
      sealed: string,
    ) => {
      const row = await read(workspaceId);
      if (!row) {
        throw new CryptoError(
          "WORKSPACE_KEY_NOT_FOUND",
          "Workspace key not found",
        );
      }
      const dek = unwrapDek(ring, workspaceId, {
        kekVersion: row.kek_version,
        wrappedDek: row.wrapped_dek,
      });
      return decryptSecret(dek, { workspaceId, ...aad }, sealed);
    },
  };
}
