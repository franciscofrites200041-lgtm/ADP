import { randomBytes } from "node:crypto";
import { CryptoError, ProviderKeyEnvError } from "@middleware/adapters";
import { describe, expect, it } from "vitest";

import { checkWorkerEnv } from "./env.ts";

const valid = {
  MW_MASTER_KEY: randomBytes(32).toString("base64"),
  MW_MASTER_KEY_VERSION: "v1",
};

describe("checkWorkerEnv", () => {
  it("accepts a valid environment", () => {
    expect(() => checkWorkerEnv(valid)).not.toThrow();
  });

  it("refuses to start with OPENAI_API_KEY present", () => {
    expect(() => checkWorkerEnv({ ...valid, OPENAI_API_KEY: "sk-x" })).toThrow(
      ProviderKeyEnvError,
    );
  });

  it("refuses to start without a valid master key", () => {
    expect(() => checkWorkerEnv({})).toThrow(CryptoError);
  });
});
