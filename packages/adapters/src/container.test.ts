import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
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

  it("keeps secrets out of anything that serializes or prints the container", async () => {
    const masterKey = randomBytes(32).toString("base64");
    const container = await createContainer({
      ...validEnv,
      DATABASE_URL: "postgres://user:db-password-xyz@127.0.0.1:1/x",
      MW_MASTER_KEY: masterKey,
    });
    try {
      const keyBytes = Array.from(container.keyring.current.key.subarray(0, 8))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(" ");
      const printed = `${JSON.stringify(container)} ${inspect(container, { depth: 6 })}`;

      expect(printed).not.toContain(masterKey);
      expect(printed).not.toContain(keyBytes);
      expect(printed).not.toContain("db-password-xyz");
      // Still reachable on purpose: the API needs the URL to build its own client.
      expect(container.env.DATABASE_URL).toContain("db-password-xyz");
    } finally {
      await container.close();
    }
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

  it("rejects a missing or empty DATABASE_URL", async () => {
    const { DATABASE_URL: _omit, ...missingUrl } = validEnv;
    for (const env of [missingUrl, { ...validEnv, DATABASE_URL: "" }]) {
      await expect(createContainer(env)).rejects.toMatchObject({
        code: "INVALID_CONFIG",
        fields: ["DATABASE_URL"],
      });
    }
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
