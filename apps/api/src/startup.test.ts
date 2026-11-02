import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const providerKey = `sk-${randomBytes(16).toString("hex")}`;

describe("api entrypoint", () => {
  it("refuses to start with a provider key in the environment", () => {
    // Otherwise valid: without the guard the server would start and hang.
    const result = spawnSync(process.execPath, ["src/index.ts"], {
      cwd: appDir,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        SystemRoot: process.env.SystemRoot,
        DATABASE_URL: "postgres://mw_test@127.0.0.1:1/middleware_test",
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3001",
        SMTP_URL: "smtp://localhost:1025",
        MAIL_FROM: "Middleware <no-reply@localhost>",
        MW_MASTER_KEY: randomBytes(32).toString("base64"),
        MW_MASTER_KEY_VERSION: "v1",
        OPENAI_API_KEY: providerKey,
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).not.toContain(providerKey);
    expect(output).not.toContain("[api] listening");
  });
});
