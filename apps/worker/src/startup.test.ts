import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const validEnv = {
  SystemRoot: process.env.SystemRoot,
  DATABASE_URL: "postgres://mw_test@127.0.0.1:1/middleware_test",
  MW_MASTER_KEY: randomBytes(32).toString("base64"),
  MW_MASTER_KEY_VERSION: "v1",
};

// A worker that does start keeps running, so the timeout ends it with no status.
const startWorker = (env: NodeJS.ProcessEnv) => {
  const result = spawnSync(process.execPath, ["src/index.ts"], {
    cwd: appDir,
    encoding: "utf8",
    timeout: 15_000,
    env,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("worker entrypoint", () => {
  it("refuses to start with a provider key in the environment", () => {
    const providerKey = `sk-${randomBytes(16).toString("hex")}`;
    const { status, output } = startWorker({
      ...validEnv,
      OPENAI_API_KEY: providerKey,
    });

    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).not.toContain(providerKey);
    expect(output).not.toContain("[worker] started");
  });

  it("refuses to start without the container configuration", () => {
    const { DATABASE_URL: _omit, ...env } = validEnv;
    const { status, output } = startWorker(env);

    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
    expect(output).toContain("DATABASE_URL");
    expect(output).not.toContain("[worker] started");
  });
});
