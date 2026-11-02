import {
  CryptoError,
  type Keyring,
  rewrapDek,
  type WrappedDek,
} from "./envelope.ts";

export type StoredWorkspaceKey = { workspaceId: string } & WrappedDek;

export type WorkspaceKeyUpdate = StoredWorkspaceKey & { rotatedAt: Date };

/** Persistence boundary for the KEK rotation command. */
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
