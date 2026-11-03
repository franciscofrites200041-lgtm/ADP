import type { StoredCredential } from "../domain/credential.ts";
import { AliasTakenError } from "../domain/errors.ts";
import type { AuditEntry } from "../ports/audit-log.ts";
import type { SecretRef } from "../ports/secret-vault.ts";
import type { CredentialServiceDeps } from "../usecases/credentials.ts";

/** In-memory ports honoring each port contract, for use case tests. */
export function createInMemoryPorts() {
  const rows: StoredCredential[] = [];
  const auditEntries: (AuditEntry & { workspaceId: string })[] = [];
  let lastId = 0;

  const active = (workspaceId: string) =>
    rows.filter(
      (row) => row.workspaceId === workspaceId && row.archivedAt === null,
    );
  const assertAliasFree = (
    workspaceId: string,
    alias: string,
    exceptId?: string,
  ) => {
    if (
      active(workspaceId).some(
        (row) => row.alias === alias && row.id !== exceptId,
      )
    ) {
      throw new AliasTakenError();
    }
  };
  const view = ({ secret: _secret, ...credential }: StoredCredential) =>
    credential;
  const aad = (workspaceId: string, ref: SecretRef) =>
    `${workspaceId}:${ref.table}:${ref.id}:`;

  const deps: CredentialServiceDeps = {
    // Every test starts with a probe that fails loudly: a use case that forgets
    // to inject a fake cannot quietly pass.
    credentialProbe: {
      async probe() {
        throw new Error("no probe configured for this test");
      },
    },
    credentialRepo: {
      async insert(workspaceId, credential) {
        assertAliasFree(workspaceId, credential.alias);
        rows.push({ ...credential, workspaceId });
        return view(credential);
      },
      async findById(workspaceId, id) {
        const row = active(workspaceId).find(
          (candidate) => candidate.id === id,
        );
        return row ? view(row) : null;
      },
      async findSealed(workspaceId, id) {
        return (
          active(workspaceId).find((candidate) => candidate.id === id) ?? null
        );
      },
      async setStatus(workspaceId, id, status) {
        const row = active(workspaceId).find(
          (candidate) => candidate.id === id,
        );
        if (!row) return null;
        row.status = status;
        return view(row);
      },
      async list(workspaceId) {
        return active(workspaceId)
          .sort((left, right) => right.id.localeCompare(left.id))
          .map(view);
      },
      async rename(workspaceId, id, alias) {
        const row = active(workspaceId).find(
          (candidate) => candidate.id === id,
        );
        if (!row) return null;
        assertAliasFree(workspaceId, alias, id);
        row.alias = alias;
        return view(row);
      },
      async archive(workspaceId, id, archivedAt) {
        const row = active(workspaceId).find(
          (candidate) => candidate.id === id,
        );
        if (!row) return null;
        row.archivedAt = archivedAt;
        return view(row);
      },
    },
    // Reversible stand-in for AES-GCM: base64 hides the plaintext and the AAD
    // prefix makes `open` fail for another workspace or row.
    secretVault: {
      async seal(workspaceId, ref, plaintext) {
        const ciphertext = Buffer.from(
          aad(workspaceId, ref) + plaintext,
        ).toString("base64");
        return {
          ciphertext,
          iv: "fake-iv",
          authTag: "fake-tag",
          kekVersion: "1",
        };
      },
      async open(workspaceId, ref, sealed) {
        const decoded = Buffer.from(sealed.ciphertext, "base64").toString();
        if (!decoded.startsWith(aad(workspaceId, ref)))
          throw new Error("AAD mismatch");
        return decoded.slice(aad(workspaceId, ref).length);
      },
    },
    auditLog: {
      async record(workspaceId, entry) {
        auditEntries.push({ ...entry, workspaceId });
      },
    },
    clock: { now: () => new Date("2026-11-02T12:00:00.000Z") },
    idGen: {
      newId: () =>
        `0190a5f2-7b1c-7d3e-8f00-${String(++lastId).padStart(12, "0")}`,
    },
  };

  return { deps, rows, auditEntries };
}
