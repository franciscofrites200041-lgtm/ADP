import type postgres from "postgres";

import type { WorkspaceKeyStore } from "./rotate-workspace-keys.ts";

type Row = { workspace_id: string; kek_version: string; wrapped_dek: string };

/**
 * `workspace_key` store for the rotation command. `update` is one atomic
 * compare-and-swap: it matches workspace, previous KEK version AND the exact
 * wrapped DEK, so a row changed after `list` is never overwritten.
 */
export function createPostgresWorkspaceKeyStore(
  sql: postgres.Sql,
  options: { workspaceIds?: readonly string[] } = {},
): WorkspaceKeyStore {
  const { workspaceIds } = options;
  return {
    list: async () => {
      const rows = await sql<Row[]>`
        select workspace_id, kek_version, wrapped_dek from workspace_key
        ${workspaceIds ? sql`where workspace_id in ${sql(workspaceIds)}` : sql``}
        order by workspace_id`;
      return rows.map((r) => ({
        workspaceId: r.workspace_id,
        kekVersion: r.kek_version,
        wrappedDek: r.wrapped_dek,
      }));
    },
    update: async (expected, input) => {
      const updated = await sql`
        update workspace_key
        set kek_version = ${input.kekVersion},
            wrapped_dek = ${input.wrappedDek},
            rotated_at = ${input.rotatedAt}
        where workspace_id = ${expected.workspaceId}
          and kek_version = ${expected.kekVersion}
          and wrapped_dek = ${expected.wrappedDek}`;
      return updated.count === 1;
    },
  };
}
