import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The API imports this package and runs with `node src/index.ts`, which only
// strips types and does not map `./x.js` to `./x.ts`. A `.js` specifier passes
// typecheck and Vitest but crashes at startup, so import the real modules.
const entrypoints = ["./index.ts", "./cli.ts", "./migrate.ts"];

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
