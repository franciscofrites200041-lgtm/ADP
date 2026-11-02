import type { SealedSecret } from "../domain/credential.ts";

/** The row a secret belongs to; with the workspace it forms the AAD (S1). */
export type SecretRef = { table: string; id: string };

export type SecretVault = {
  seal(
    workspaceId: string,
    ref: SecretRef,
    plaintext: string,
  ): Promise<SealedSecret>;
  open(
    workspaceId: string,
    ref: SecretRef,
    sealed: SealedSecret,
  ): Promise<string>;
};
