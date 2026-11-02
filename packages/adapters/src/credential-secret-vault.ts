import type { SecretVault } from "@middleware/core";
import type postgres from "postgres";

import { CryptoError } from "./envelope.ts";
import type { createWorkspaceKeyVault } from "./workspace-key-vault.ts";

// Layout of the WP-06 packed string: iv (12) | auth tag (16) | ciphertext.
const IV_BYTES = 12;
const TAG_BYTES = 16;

type WorkspaceKeys = Pick<
  ReturnType<typeof createWorkspaceKeyVault>,
  "encrypt" | "decrypt"
>;

/**
 * `SecretVault` over the workspace DEK (WP-06). The AAD binds each secret to
 * workspace, table and id, so `open` fails with `CryptoError` elsewhere.
 */
export function createCredentialSecretVault(
  sql: postgres.Sql,
  workspaceKeys: WorkspaceKeys,
): SecretVault {
  return {
    async seal(workspaceId, ref, plaintext) {
      const packed = Buffer.from(
        await workspaceKeys.encrypt(workspaceId, ref, plaintext),
        "base64",
      );
      // Informational (decision H): the wrapper version at write time.
      const [key] = await sql<{ kek_version: string }[]>`
        select kek_version from workspace_key where workspace_id = ${workspaceId}`;
      if (!key) {
        throw new CryptoError(
          "WORKSPACE_KEY_NOT_FOUND",
          "Workspace key not found",
        );
      }
      return {
        iv: packed.subarray(0, IV_BYTES).toString("base64"),
        authTag: packed
          .subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
          .toString("base64"),
        ciphertext: packed.subarray(IV_BYTES + TAG_BYTES).toString("base64"),
        kekVersion: key.kek_version,
      };
    },
    async open(workspaceId, ref, sealed) {
      const packed = Buffer.concat(
        [sealed.iv, sealed.authTag, sealed.ciphertext].map((part) =>
          Buffer.from(part, "base64"),
        ),
      );
      return workspaceKeys.decrypt(workspaceId, ref, packed.toString("base64"));
    },
  };
}
