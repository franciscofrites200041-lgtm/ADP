import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { credentialResponseSchema } from "@middleware/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "./logger.ts";
import {
  createIntegrationHarness,
  type TestSession,
  testDatabaseUrl,
} from "./testing/integration-harness.ts";

const url = testDatabaseUrl();
const KEY = `sk-redaction-${randomUUID()}`;

type Harness = Awaited<ReturnType<typeof createIntegrationHarness>>;

// S2 / S5: the plaintext key leaves no trace in responses, logs or tables.
describe.skipIf(!url)("key redaction against postgres", () => {
  const logLines: string[] = [];
  const responses: string[] = [];
  let harness: Harness;
  let ana: TestSession;

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    harness = await createIntegrationHarness(url ?? "", createLogger(stream));
    ana = await harness.signUp("Ana");
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await harness.app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie: ana.cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    responses.push(await res.text());
    return res;
  };

  const rowsOf = async (table: string) => {
    const rows = await harness.sql<{ row: string }[]>`
      select t::text as row from ${harness.sql(table)} t
      where workspace_id = ${ana.workspaceId}`;
    return rows.map((r) => r.row);
  };

  it("never exposes the key after create, list, rename, archive and failures", async () => {
    const create = await call("POST", "/api/credentials", {
      providerId: "openai",
      alias: "redaction",
      apiKey: KEY,
    });
    expect(create.status).toBe(201);
    const { id } = credentialResponseSchema.parse(
      JSON.parse(responses.at(-1) ?? ""),
    );
    expect((await call("GET", "/api/credentials")).status).toBe(200);
    expect(
      (await call("PATCH", `/api/credentials/${id}`, { alias: "renamed" }))
        .status,
    ).toBe(200);
    // Deliberate failures: the database rejects a NUL byte after sealing the
    // key (logged as unknown), and the contract rejects an unknown field.
    expect(
      (
        await call("POST", "/api/credentials", {
          providerId: "openai",
          alias: "nul\u0000byte",
          apiKey: KEY,
        })
      ).status,
    ).toBe(500);
    expect(
      (
        await call("POST", "/api/credentials", {
          providerId: "openai",
          alias: "extra",
          apiKey: KEY,
          secret: KEY,
        })
      ).status,
    ).toBe(400);
    expect((await call("DELETE", `/api/credentials/${id}`)).status).toBe(204);

    const log = logLines.join("");
    expect(log).toContain("PersistenceError");
    const rows = [
      ...(await rowsOf("provider_credential")),
      ...(await rowsOf("audit_log")),
      ...(await rowsOf("workspace_key")),
    ];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const text of [...responses, log, ...rows]) {
      expect(text).not.toContain(KEY);
    }
    for (const field of ["ciphertext", "iv", "authTag", "apiKey"]) {
      for (const body of responses) expect(body).not.toContain(`"${field}"`);
    }
  });
});
