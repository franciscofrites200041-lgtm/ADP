import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.ts";

const SECRET = "sk-must-never-be-logged";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: createLogger(stream), output: () => lines.join("") };
}

describe("createLogger", () => {
  it("redacts secret fields (S2)", () => {
    const { logger, output } = capture();

    logger.info(
      {
        apiKey: SECRET,
        authorization: SECRET,
        cookie: SECRET,
        secret: SECRET,
        token: SECRET,
        password: SECRET,
        provider: { key: SECRET },
        req: { headers: { cookie: SECRET, authorization: SECRET } },
        workspaceId: "workspace-a",
      },
      "credential created",
    );

    expect(output()).not.toContain(SECRET);
    expect(JSON.parse(output())).toMatchObject({
      workspaceId: "workspace-a",
      msg: "credential created",
    });
  });
});
