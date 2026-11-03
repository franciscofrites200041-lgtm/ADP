import type { CredentialStatus } from "@middleware/contracts";

import type { Credential, StoredCredential } from "../domain/credential.ts";

/**
 * Every method scopes by `workspaceId` (S4). Reads see only non-archived
 * credentials. `insert` and `rename` reject with `AliasTakenError` when an
 * active credential of the workspace already has the alias.
 */
export type CredentialRepo = {
  insert(
    workspaceId: string,
    credential: StoredCredential,
  ): Promise<Credential>;
  findById(workspaceId: string, id: string): Promise<Credential | null>;
  /**
   * The same row with its sealed secret, for the only operation that needs the
   * plaintext: probing the credential. Callers must open it through the vault.
   */
  findSealed(workspaceId: string, id: string): Promise<StoredCredential | null>;
  /** Records the outcome of a connection test (WP-12). */
  setStatus(
    workspaceId: string,
    id: string,
    status: CredentialStatus,
  ): Promise<Credential | null>;
  /** Newest first (ids are UUIDv7). */
  list(workspaceId: string): Promise<Credential[]>;
  rename(
    workspaceId: string,
    id: string,
    alias: string,
  ): Promise<Credential | null>;
  archive(
    workspaceId: string,
    id: string,
    archivedAt: Date,
  ): Promise<Credential | null>;
};
