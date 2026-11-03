import type { AgentVersionInput } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { createInMemoryAgentRepo } from "../testing/in-memory-agent-ports.ts";
import { createInMemoryPorts } from "../testing/in-memory-ports.ts";
import { createAgentService } from "./agents.ts";
import { createCredentialService } from "./credentials.ts";

const workspaceA = "0190a5f2-0000-7000-8000-00000000000a";
const userA = "0190a5f2-0000-7000-8000-0000000000a1";
const apiKey = "sk-test-secret-9f3k";

const content = (instructions: string, credentialId: string) =>
  ({
    instructions,
    providerId: "openai",
    modelId: "gpt-5",
    credentialId,
    params: { temperature: 0.3 },
    tools: ["web_search"],
  }) satisfies AgentVersionInput;

function setup() {
  const ports = createInMemoryPorts();
  const agentRepo = createInMemoryAgentRepo();
  const service = createAgentService({
    agentRepo,
    credentialRepo: ports.deps.credentialRepo,
    auditLog: ports.deps.auditLog,
    clock: ports.deps.clock,
    idGen: ports.deps.idGen,
  });
  const credentials = createCredentialService(ports.deps);

  const credential = async (workspaceId: string, alias: string) =>
    (
      await credentials.createCredential(workspaceId, userA, {
        providerId: "openai",
        alias,
        apiKey,
      })
    ).id;

  return { service, agentRepo, credential, auditEntries: ports.auditEntries };
}

describe("agents and their versions", () => {
  // Cross-tenant behaviour is verified against real Postgres in
  // apps/api/src/agents.integration.test.ts: AGENTS.md forbids in-memory doubles
  // for tenancy, because they encode exactly the bug they are meant to catch.
  it("creates an agent with its first version as current", async () => {
    const { service, credential } = setup();
    const credentialId = await credential(workspaceA, "Personal");

    const created = await service.createAgent(workspaceA, userA, {
      name: "Soporte",
      version: content("Atendé consultas.", credentialId),
    });

    expect(created.name).toBe("Soporte");
    expect(created.currentVersion?.version).toBe(1);
    expect(created.currentVersion?.instructions).toBe("Atendé consultas.");
  });

  it("editing appends a new version and leaves the old one untouched", async () => {
    const { service, agentRepo, credential } = setup();
    const credentialId = await credential(workspaceA, "Personal");
    const created = await service.createAgent(workspaceA, userA, {
      name: "Soporte",
      version: content("Primera.", credentialId),
    });

    const updated = await service.updateAgent(workspaceA, userA, created.id, {
      name: "Soporte 2",
      version: content("Segunda.", credentialId),
    });

    expect(updated.name).toBe("Soporte 2");
    expect(updated.currentVersion?.version).toBe(2);
    expect(agentRepo.versions.map((v) => [v.version, v.instructions])).toEqual([
      [1, "Primera."],
      [2, "Segunda."],
    ]);
  });

  it("restoring a version appends a copy instead of rewriting history", async () => {
    const { service, agentRepo, credential } = setup();
    const credentialId = await credential(workspaceA, "Personal");
    const created = await service.createAgent(workspaceA, userA, {
      name: "Soporte",
      version: content("Primera.", credentialId),
    });
    const first = created.currentVersion;
    if (!first) throw new Error("first version missing");
    await service.updateAgent(workspaceA, userA, created.id, {
      version: content("Segunda.", credentialId),
    });

    const restored = await service.restoreVersion(
      workspaceA,
      userA,
      created.id,
      first.id,
    );

    expect(restored.currentVersion?.version).toBe(3);
    expect(restored.currentVersion?.instructions).toBe("Primera.");
    expect(agentRepo.versions).toHaveLength(3);
    const original = agentRepo.versions.find((v) => v.id === first.id);
    expect(original?.instructions).toBe("Primera.");
  });

  it("duplicates an agent with a copy of its current version", async () => {
    const { service, credential } = setup();
    const credentialId = await credential(workspaceA, "Personal");
    const created = await service.createAgent(workspaceA, userA, {
      name: "Soporte",
      version: content("Atendé consultas.", credentialId),
    });

    const copy = await service.duplicateAgent(workspaceA, userA, created.id, {
      name: "Soporte copia",
    });

    expect(copy.id).not.toBe(created.id);
    expect(copy.name).toBe("Soporte copia");
    expect(copy.currentVersion?.version).toBe(1);
    expect(copy.currentVersion?.instructions).toBe("Atendé consultas.");
  });
});
