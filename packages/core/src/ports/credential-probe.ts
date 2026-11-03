import type { CredentialTestCode, ProviderId } from "@middleware/contracts";

/** What a probe needs to reach a provider. The key is plaintext here and nowhere else. */
export type ProbeTarget = {
  providerId: ProviderId;
  apiKey: string;
  baseUrl: string | null;
};

/** A probe either works or fails with a reason the UI can translate (S1). */
export type ProbeResult =
  | { status: "valid" }
  | { status: "invalid"; code: CredentialTestCode };

export type CredentialProbe = {
  probe(target: ProbeTarget): Promise<ProbeResult>;
};
