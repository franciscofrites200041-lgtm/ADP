import type {
  CreateCredentialRequest,
  CredentialResponse,
  RenameCredentialRequest,
} from "@middleware/contracts";

import { NotImplementedError } from "../domain/errors.ts";
import type { AuditLog } from "../ports/audit-log.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialRepo } from "../ports/credential-repo.ts";
import type { IdGen } from "../ports/id-gen.ts";
import type { SecretVault } from "../ports/secret-vault.ts";

export type CredentialServiceDeps = {
  credentialRepo: CredentialRepo;
  secretVault: SecretVault;
  auditLog: AuditLog;
  clock: Clock;
  idGen: IdGen;
};

/** `workspaceId` and `actorUserId` come from the session, never the request (S4). */
export type CredentialService = {
  createCredential(
    workspaceId: string,
    actorUserId: string,
    input: CreateCredentialRequest,
  ): Promise<CredentialResponse>;
  listCredentials(workspaceId: string): Promise<CredentialResponse[]>;
  renameCredential(
    workspaceId: string,
    actorUserId: string,
    credentialId: string,
    input: RenameCredentialRequest,
  ): Promise<CredentialResponse>;
  archiveCredential(
    workspaceId: string,
    actorUserId: string,
    credentialId: string,
  ): Promise<void>;
};

export function createCredentialService(
  _deps: CredentialServiceDeps,
): CredentialService {
  const notImplemented = (useCase: string) => async (): Promise<never> => {
    throw new NotImplementedError(useCase);
  };

  return {
    createCredential: notImplemented("createCredential"),
    listCredentials: notImplemented("listCredentials"),
    renameCredential: notImplemented("renameCredential"),
    archiveCredential: notImplemented("archiveCredential"),
  };
}
