import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The API and worker run `node src/index.ts`, which only strips types. Syntax
// that needs a transform (parameter properties, enums, namespaces) passes
// typecheck and Vitest but crashes at startup, so import the real modules.
const entrypoints = [
  "./index.ts",
  "./container.ts",
  "./audit-log-repo.ts",
  "./credential-repo.ts",
  "./credential-secret-vault.ts",
  "./pi-model-gateway.ts",
  "./system-ports.ts",
  "./rotate-workspace-keys-db.ts",
  "./rotate-workspace-keys-cli.ts",
];

describe("native Node type stripping", () => {
  it.each(entrypoints)("can import %s", (entrypoint) => {
    const href = new URL(entrypoint, import.meta.url).href;

    expect(() =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", `await import(${JSON.stringify(href)})`],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });
});
