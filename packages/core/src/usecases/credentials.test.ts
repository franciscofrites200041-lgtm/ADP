import type { CreateCredentialRequest } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { AliasTakenError, NotFoundError } from "../domain/errors.ts";
import type { UrlGuard } from "../ports/url-guard.ts";
import { ForbiddenUrlError } from "../security/forbidden-url-error.ts";
import { createInMemoryPorts } from "../testing/in-memory-ports.ts";
import { createCredentialService } from "./credentials.ts";

const workspaceA = "0190a5f2-0000-7000-8000-00000000000a";
const userA = "0190a5f2-0000-7000-8000-0000000000a1";
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
    await service.archiveCredential(workspaceA, userA, archived.id);

    await expect(service.listCredentials(workspaceA)).resolves.toEqual([
      newer,
      older,
    ]);
  });
});

// The S4 proof against real Postgres lives in
// apps/api/src/credentials.integration.test.ts; this is the use-case contract.

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

  it("treats an unknown credential as missing", async () => {
    const { service } = setupWith({ status: "valid" });

    await expect(
      service.testCredential(workspaceA, userA, crypto.randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createCredential with a baseUrl (S5)", () => {
  const compatibleRequest = (baseUrl: string): CreateCredentialRequest => ({
    providerId: "openai-compatible",
    alias: "Compatible",
    apiKey,
    baseUrl,
  });

  // A stub is enough here: the real DNS-pinning guard belongs to the
  // adapters tests; the use case only owns the "validate before storing"
  // ordering, which any guard stub makes observable.
  const guardAllowing = (): UrlGuard => ({
    assertAllowed: async (rawUrl) => ({
      url: new URL(rawUrl),
      addresses: ["93.184.216.34"],
    }),
  });

  const guardRefusing = (): UrlGuard => ({
    assertAllowed: async () => {
      throw new ForbiddenUrlError("private");
    },
  });

  it("stores a credential whose baseUrl the guard approves", async () => {
    const ports = createInMemoryPorts();
    const service = createCredentialService({
      ...ports.deps,
      urlGuard: guardAllowing(),
    });

    const created = await service.createCredential(
      workspaceA,
      userA,
      compatibleRequest("https://llm.example.com/v1"),
    );

    expect(created).toMatchObject({
      providerId: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
    });
    expect(ports.auditEntries).toHaveLength(1);
  });

  it("writes nothing and records no audit when the guard refuses", async () => {
    const ports = createInMemoryPorts();
    const service = createCredentialService({
      ...ports.deps,
      urlGuard: guardRefusing(),
    });

    await expect(
      service.createCredential(
        workspaceA,
        userA,
        compatibleRequest("https://169.254.169.254/v1"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenUrlError);

    expect(ports.rows).toEqual([]);
    expect(ports.auditEntries).toEqual([]);
  });
});
