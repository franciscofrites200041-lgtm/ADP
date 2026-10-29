import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ContainerConfigError, createContainer } from "./container.ts";
import { CryptoError } from "./envelope.ts";
import { ProviderKeyEnvError } from "./provider-env.ts";

// Port 1 refuses connections: validation must fail before any connection.
const validEnv = {
  DATABASE_URL: "postgres://mw_test@127.0.0.1:1/middleware_test",
  MW_MASTER_KEY: randomBytes(32).toString("base64"),
  MW_MASTER_KEY_VERSION: "v1",
};

describe("createContainer configuration", () => {
  it("refuses provider credential variables before validating anything else", async () => {
    await expect(
      createContainer({ ...validEnv, OPENAI_API_KEY: "sk-test" }),
    ).rejects.toBeInstanceOf(ProviderKeyEnvError);
    await expect(
      createContainer({ OPENAI_API_KEY: "sk-test" }),
    ).rejects.toBeInstanceOf(ProviderKeyEnvError);
  });

  it("rejects a master key that is not 32 bytes", async () => {
    await expect(
      createContainer({ ...validEnv, MW_MASTER_KEY: "c2hvcnQ=" }),
    ).rejects.toMatchObject({ code: "INVALID_KEY" });
    await expect(
      createContainer({ ...validEnv, MW_MASTER_KEY: "c2hvcnQ=" }),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it("names invalid fields without echoing their values", async () => {
    const { MW_MASTER_KEY_VERSION: _omit, ...missingVersion } = validEnv;
    const error = await createContainer({
      ...missingVersion,
      DATABASE_URL: "hunter2 is not a url",
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContainerConfigError);
    expect(error).toMatchObject({ code: "INVALID_CONFIG" });
    expect((error as ContainerConfigError).fields).toEqual([
      "DATABASE_URL",
      "MW_MASTER_KEY_VERSION",
    ]);
    expect(String(error)).not.toContain("hunter2");
  });
});

// Opt-in like the other database tests: disposable database only.
const databaseUrl = process.env.DATABASE_URL_TEST;
if (databaseUrl) {
  const { hostname, pathname } = new URL(databaseUrl);
  if (hostname !== "127.0.0.1" || pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!databaseUrl)("createContainer with PostgreSQL", () => {
  it("wires a working workspace key vault and closes idempotently", async () => {
    const container = await createContainer({
      ...validEnv,
      DATABASE_URL: databaseUrl ?? "",
    });
    const workspaceId = randomUUID();
    const aad = { table: "provider_credential", id: "c1" };
    try {
      const sealed = await container.workspaceKeys.encrypt(
        workspaceId,
        aad,
        "test-secret",
      );
      expect(
        await container.workspaceKeys.decrypt(workspaceId, aad, sealed),
      ).toBe("test-secret");
    } finally {
      await container.sql`delete from workspace_key where workspace_id = ${workspaceId}`;
      await container.close();
    }
    await expect(container.close()).resolves.toBeUndefined();
  });
});
