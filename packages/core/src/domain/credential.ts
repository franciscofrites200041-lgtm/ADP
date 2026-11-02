import type { CredentialStatus, ProviderId } from "@middleware/contracts";

/** A provider API key as the domain sees it: the key itself never is here. */
export type Credential = {
  id: string;
  workspaceId: string;
  providerId: ProviderId;
  alias: string;
  last4: string;
  baseUrl: string | null;
  status: CredentialStatus;
  createdBy: string;
  archivedAt: Date | null;
};

/** AES-256-GCM output, stored as the three columns of `provider_credential`. */
export type SealedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  kekVersion: string;
};

export type StoredCredential = Credential & { secret: SealedSecret };
