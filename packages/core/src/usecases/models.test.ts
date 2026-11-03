import type { ModelDescriptor } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { NotFoundError } from "../domain/errors.ts";
import type { Clock } from "../ports/clock.ts";
import type { ModelCache } from "../ports/model-cache.ts";
import { createInMemoryPorts } from "../testing/in-memory-ports.ts";
import { createCredentialService } from "./credentials.ts";
import { createModelService, MODEL_CACHE_TTL_MS } from "./models.ts";

const workspaceA = "0190a5f2-0000-7000-8000-00000000000a";
const workspaceB = "0190a5f2-0000-7000-8000-00000000000b";
const userA = "0190a5f2-0000-7000-8000-0000000000a1";
const apiKey = "sk-test-secret-9f3k";

const discovered: ModelDescriptor[] = [
  {
    id: "gpt-5",
    name: "GPT-5",
    providerId: "openai",
    contextWindow: 400_000,
    maxTokens: 128_000,
    reasoning: true,
  },
];

/** A clock the test moves by hand: the hour is the point. */
function fakeClock(start = new Date("2026-01-01T00:00:00.000Z")) {
  let current = start;
  return {
    clock: { now: () => current } satisfies Clock,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** Honours the expiry it is given, so the TTL is the use case's decision. */
function fakeCache() {
  const entries = new Map<
    string,
    { models: ModelDescriptor[]; expiresAt: Date }
  >();
  return {
    cache: {
      async read(key, now) {
        const entry = entries.get(key);
        return entry && entry.expiresAt > now ? entry.models : null;
      },
      async write(key, models, expiresAt) {
        entries.set(key, { models, expiresAt });
      },
    } satisfies ModelCache,
    keys: () => [...entries.keys()],
  };
}

function setup() {
  const ports = createInMemoryPorts();
  const { clock, advance } = fakeClock();
  const { cache } = fakeCache();
  let calls = 0;

  const service = createModelService({
    credentialRepo: ports.deps.credentialRepo,
    secretVault: ports.deps.secretVault,
    modelCache: cache,
    clock,
    modelGateway: {
      async listModels() {
        calls += 1;
        return discovered;
      },
      findModel: () => null,
      async *stream() {
        yield* [];
      },
    },
  });

  const create = async (alias: string) =>
    (
      await createCredentialService(ports.deps).createCredential(
        workspaceA,
        userA,
        { providerId: "openai", alias, apiKey },
      )
    ).id;

  return {
    service,
    create,
    deps: ports.deps,
    advance,
    count: () => calls,
  };
}

describe("listModels", () => {
  it("discovers the provider catalogue and remembers it for an hour", async () => {
    const { service, create, count } = setup();
    const id = await create("Personal");

    const first = await service.listModels(workspaceA, id);
    const second = await service.listModels(workspaceA, id);

    expect(first).toEqual(discovered);
    expect(second).toEqual(discovered);
    expect(count()).toBe(1);
  });

  it("asks the provider again once the hour has passed", async () => {
    const { service, create, advance, count } = setup();
    const id = await create("Personal");
    await service.listModels(workspaceA, id);

    advance(MODEL_CACHE_TTL_MS + 1);
    await service.listModels(workspaceA, id);

    expect(count()).toBe(2);
  });

  it("does not serve an archived credential from the cache", async () => {
    const { service, create, deps } = setup();
    const id = await create("Personal");
    await service.listModels(workspaceA, id);

    await deps.credentialRepo.archive(workspaceA, id, new Date());

    await expect(service.listModels(workspaceA, id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("does not answer for a credential of another workspace", async () => {
    const { service, create } = setup();
    const id = await create("Personal");

    await expect(service.listModels(workspaceB, id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
