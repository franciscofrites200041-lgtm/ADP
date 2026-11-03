import type {
  CreateCredentialRequest,
  CredentialResponse,
  CredentialTestResponse,
  RenameCredentialRequest,
} from "@middleware/contracts";

import type { Credential } from "../domain/credential.ts";
import { NotFoundError } from "../domain/errors.ts";
import type { AuditLog } from "../ports/audit-log.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialProbe } from "../ports/credential-probe.ts";
import type { CredentialRepo } from "../ports/credential-repo.ts";
import type { IdGen } from "../ports/id-gen.ts";
import type { SecretVault } from "../ports/secret-vault.ts";

const TABLE = "provider_credential";

export type CredentialServiceDeps = {
  credentialRepo: CredentialRepo;
  credentialProbe: CredentialProbe;
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
  /**
   * Probes the stored key against its provider and records the outcome (S1).
   * A credential of another workspace is indistinguishable from a missing one.
   */
  testCredential(
    workspaceId: string,
    actorUserId: string,
    credentialId: string,
  ): Promise<CredentialTestResponse>;
};

/** The public view (S2): picks fields instead of omitting, so a new column never leaks. */
function toResponse(credential: Credential): CredentialResponse {
  return {
    id: credential.id,
    providerId: credential.providerId,
    alias: credential.alias,
    last4: credential.last4,
    status: credential.status,
    baseUrl: credential.baseUrl,
  };
}

export function createCredentialService({
  credentialRepo,
  credentialProbe,
  secretVault,
  auditLog,
  clock,
  idGen,
}: CredentialServiceDeps): CredentialService {
  const audit = (
    workspaceId: string,
    actorUserId: string,
    action: string,
    targetId: string,
    metadata: Record<string, string> = {},
  ) =>
    auditLog.record(workspaceId, {
      actorUserId,
      action,
      targetType: TABLE,
      targetId,
      metadata,
    });

  return {
    async createCredential(workspaceId, actorUserId, input) {
      const id = idGen.newId();
      const secret = await secretVault.seal(
        workspaceId,
        { table: TABLE, id },
        input.apiKey,
      );
      const created = await credentialRepo.insert(workspaceId, {
        id,
        workspaceId,
        providerId: input.providerId,
        alias: input.alias,
        last4: input.apiKey.slice(-4),
        baseUrl: input.baseUrl ?? null,
        status: "unchecked",
        createdBy: actorUserId,
        archivedAt: null,
        secret,
      });
      await audit(workspaceId, actorUserId, "credential.created", id, {
        providerId: input.providerId,
        alias: input.alias,
      });
      return toResponse(created);
    },

    async listCredentials(workspaceId) {
      return (await credentialRepo.list(workspaceId)).map(toResponse);
    },

    async renameCredential(workspaceId, actorUserId, credentialId, input) {
      const renamed = await credentialRepo.rename(
        workspaceId,
        credentialId,
        input.alias,
      );
      if (!renamed) throw new NotFoundError();
      await audit(
        workspaceId,
        actorUserId,
        "credential.renamed",
        credentialId,
        {
          alias: input.alias,
        },
      );
      return toResponse(renamed);
    },

    async archiveCredential(workspaceId, actorUserId, credentialId) {
      const archived = await credentialRepo.archive(
        workspaceId,
        credentialId,
        clock.now(),
      );
      if (!archived) throw new NotFoundError();
      await audit(
        workspaceId,
        actorUserId,
        "credential.archived",
        credentialId,
      );
    },

    async testCredential(workspaceId, actorUserId, credentialId) {
      const stored = await credentialRepo.findSealed(workspaceId, credentialId);
      if (!stored) throw new NotFoundError();

      const apiKey = await secretVault.open(
        workspaceId,
        { table: TABLE, id: stored.id },
        stored.secret,
      );
      const result = await credentialProbe.probe({
        providerId: stored.providerId,
        apiKey,
        baseUrl: stored.baseUrl,
      });

      const updated = await credentialRepo.setStatus(
        workspaceId,
        credentialId,
        result.status,
      );
      if (!updated) throw new NotFoundError();

      // The key never reaches the audit log: only the outcome and its reason do.
      await audit(
        workspaceId,
        actorUserId,
        "credential.tested",
        credentialId,
        result.status === "valid"
          ? { status: "valid" }
          : { status: "invalid", code: result.code },
      );

      return result.status === "valid"
        ? { status: "valid", code: null }
        : { status: "invalid", code: result.code };
    },
  };
}
