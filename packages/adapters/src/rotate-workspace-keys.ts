import {
  CryptoError,
  type Keyring,
  rewrapDek,
  type WrappedDek,
} from "./envelope.ts";

export type StoredWorkspaceKey = { workspaceId: string } & WrappedDek;

type WorkspaceKeyUpdate = StoredWorkspaceKey & { rotatedAt: Date };

/**
 * Persistence boundary for the master-key rotation.
 *
 * Deliberate exception to "every repository takes workspaceId first", granted by
 * MIDDLEWARE_MASTER.md §8 (seguridad de claves): "Rotación: se agrega una versión
 * nueva de KEK y se re-envuelven las DEK con un script
 * (docs/runbooks/rotar-clave-maestra.md)". The authorised operation is a
 * system-wide re-wrap of every workspace DEK, so the port cannot be scoped to
 * one tenant and has no session to derive it from. It is unreachable from HTTP.
 * The request-scoped repositories keep the workspaceId-first rule.
 */
export type WorkspaceKeyStore = {
  list: () => Promise<readonly StoredWorkspaceKey[]>;
  update: (
    expected: StoredWorkspaceKey,
    input: WorkspaceKeyUpdate,
  ) => Promise<boolean>;
};

export type WorkspaceKeyRotationResult = {
  scanned: number;
  rotated: number;
  skipped: number;
};

/**
 * Re-wraps every workspace DEK that is not already protected by the current
 * KEK. Secret ciphertext remains untouched because its workspace DEK does not
 * change. A store update happens only after the existing DEK is authenticated
 * and successfully re-wrapped.
 */
export async function rotateWorkspaceKeys(input: {
  ring: Keyring;
  store: WorkspaceKeyStore;
  rotatedAt: Date;
}): Promise<WorkspaceKeyRotationResult> {
  const rows = await input.store.list();
  let rotated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.kekVersion === input.ring.current.version) {
      skipped += 1;
      continue;
    }

    const rewrapped = rewrapDek(input.ring, row.workspaceId, row);
    const updated = await input.store.update(row, {
      workspaceId: row.workspaceId,
      ...rewrapped,
      rotatedAt: input.rotatedAt,
    });
    if (!updated) {
      throw new CryptoError(
        "WORKSPACE_KEY_CONFLICT",
        "Workspace key changed during rotation",
      );
    }
    rotated += 1;
  }

  return { scanned: rows.length, rotated, skipped };
}
