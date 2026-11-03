import type { CreateCredentialRequest } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { AliasTakenError, NotFoundError } from "../domain/errors.ts";
import { createInMemoryPorts } from "../testing/in-memory-ports.ts";
import { createCredentialService } from "./credentials.ts";

const workspaceA = "0190a5f2-0000-7000-8000-00000000000a";
const workspaceB = "0190a5f2-0000-7000-8000-00000000000b";
const userA = "0190a5f2-0000-7000-8000-0000000000a1";
const userB = "0190a5f2-0000-7000-8000-0000000000b1";
const apiKey = "sk-test-secret-9f3k";

const request = (alias: string): CreateCredentialRequest => ({
  providerId: "openai",
  alias,
  apiKey,
});

function setup() {
  const ports = createInMemoryPorts();
  return { ...ports, service: createCredentialService(ports.deps) };
}

describe("createCredential", () => {
  it("stores a sealed secret and returns only the public view", async () => {
    const { service, rows, deps } = setup();

    const created = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );

    expect(created).toEqual({
      id: expect.any(String),
      providerId: "openai",
      alias: "Personal",
      last4: "9f3k",
      status: "unchecked",
      baseUrl: null,
    });
    expect(JSON.stringify(rows)).not.toContain(apiKey);
    const stored = rows[0];
    if (!stored) throw new Error("credential was not stored");
    const ref = { table: "provider_credential", id: created.id };
    await expect(
      deps.secretVault.open(workspaceA, ref, stored.secret),
    ).resolves.toBe(apiKey);
  });

  it("rejects a second active credential with the same alias in a workspace", async () => {
    const { service } = setup();
    await service.createCredential(workspaceA, userA, request("Personal"));

    await expect(
      service.createCredential(workspaceA, userA, request("Personal")),
    ).rejects.toBeInstanceOf(AliasTakenError);
  });

  it("allows the same alias in another workspace", async () => {
    const { service } = setup();
    await service.createCredential(workspaceA, userA, request("Personal"));

    await expect(
      service.createCredential(workspaceB, userB, request("Personal")),
    ).resolves.toMatchObject({ alias: "Personal" });
  });

  it("allows an alias again once its credential is archived", async () => {
    const { service } = setup();
    const first = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );
    await service.archiveCredential(workspaceA, userA, first.id);

    await expect(
      service.createCredential(workspaceA, userA, request("Personal")),
    ).resolves.toMatchObject({ alias: "Personal" });
  });
});

describe("listCredentials", () => {
  it("returns the workspace's active credentials, newest first", async () => {
    const { service } = setup();
    const older = await service.createCredential(
      workspaceA,
      userA,
      request("Older"),
    );
    const archived = await service.createCredential(
      workspaceA,
      userA,
      request("Gone"),
    );
    const newer = await service.createCredential(
      workspaceA,
      userA,
      request("Newer"),
    );
    await service.createCredential(workspaceB, userB, request("Other"));
    await service.archiveCredential(workspaceA, userA, archived.id);

    await expect(service.listCredentials(workspaceA)).resolves.toEqual([
      newer,
      older,
    ]);
  });
});

describe("cross-tenant access (S4)", () => {
  it("hides another workspace's credential from rename and archive", async () => {
    const { service } = setup();
    const owned = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );

    await expect(
      service.renameCredential(workspaceB, userB, owned.id, {
        alias: "Stolen",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.archiveCredential(workspaceB, userB, owned.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.listCredentials(workspaceA)).resolves.toEqual([owned]);
  });
});

describe("audit log (S2)", () => {
  it("records create, rename and archive without the key", async () => {
    const { service, auditEntries } = setup();
    const created = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );
    await service.renameCredential(workspaceA, userA, created.id, {
      alias: "Main",
    });
    await service.archiveCredential(workspaceA, userA, created.id);

    expect(auditEntries).toHaveLength(3);
    for (const entry of auditEntries) {
      expect(entry).toMatchObject({
        workspaceId: workspaceA,
        actorUserId: userA,
        targetType: "provider_credential",
        targetId: created.id,
      });
    }
    expect(JSON.stringify(auditEntries)).not.toContain(apiKey);
  });
});

describe("testCredential", () => {
  function setupWith(
    result:
      | { status: "valid" }
      | {
          status: "invalid";
          code:
            | "invalid_key"
            | "provider_unreachable"
            | "rate_limited"
            | "provider_error";
        },
  ) {
    const ports = createInMemoryPorts();
    const probed: { apiKey: string; providerId: string }[] = [];
    ports.deps.credentialProbe = {
      async probe(target) {
        probed.push({ apiKey: target.apiKey, providerId: target.providerId });
        return result;
      },
    };
    return {
      ...ports,
      probed,
      service: createCredentialService(ports.deps),
    };
  }

  it("marks a working key valid and records it without the secret", async () => {
    const { service, rows, auditEntries, probed } = setupWith({
      status: "valid",
    });
    const created = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );

    const outcome = await service.testCredential(workspaceA, userA, created.id);

    expect(outcome).toEqual({ status: "valid", code: null });
    expect(probed).toEqual([{ apiKey, providerId: "openai" }]);
    const stored = rows[0];
    if (!stored) throw new Error("credential was not stored");
    expect(stored.status).toBe("valid");
    expect(JSON.stringify(auditEntries)).not.toContain(apiKey);
  });

  it("marks a rejected key invalid and keeps the reason", async () => {
    const { service, rows } = setupWith({
      status: "invalid",
      code: "invalid_key",
    });
    const created = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );

    const outcome = await service.testCredential(workspaceA, userA, created.id);

    expect(outcome).toEqual({ status: "invalid", code: "invalid_key" });
    const stored = rows[0];
    if (!stored) throw new Error("credential was not stored");
    expect(stored.status).toBe("invalid");
  });

  it("does not let another workspace test the credential", async () => {
    const { service, probed } = setupWith({ status: "valid" });
    const created = await service.createCredential(
      workspaceA,
      userA,
      request("Personal"),
    );

    await expect(
      service.testCredential(workspaceB, userB, created.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(probed).toEqual([]);
  });

  it("treats an unknown credential as missing", async () => {
    const { service } = setupWith({ status: "valid" });

    await expect(
      service.testCredential(workspaceA, userA, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
