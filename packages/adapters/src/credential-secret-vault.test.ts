import { randomBytes, randomUUID } from "node:crypto";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createAuditLogRepo } from "./audit-log-repo.ts";
import { createCredentialRepo } from "./credential-repo.ts";
import { createCredentialSecretVault } from "./credential-secret-vault.ts";
import { CryptoError, createKeyring } from "./envelope.ts";
import { createWorkspaceKeyVault } from "./workspace-key-vault.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("credential secret vault (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const db = drizzle(sql, { schema });
  const ring = createKeyring({ version: "v7", key: randomBytes(32) });
  const vault = createCredentialSecretVault(
    sql,
    createWorkspaceKeyVault(sql, ring),
  );
  const created: string[] = [];
  const workspace = () => {
    const id = randomUUID();
    created.push(id);
    return id;
  };
  const plaintext = `sk-test-${randomUUID()}`;

  afterAll(async () => {
    if (created.length) {
      await sql`delete from provider_credential where workspace_id in ${sql(created)}`;
      await sql`delete from audit_log where workspace_id in ${sql(created)}`;
      await sql`delete from workspace_key where workspace_id in ${sql(created)}`;
    }
    await sql.end();
  });

  it("splits the packed secret into columns and opens it back", async () => {
    const ws = workspace();
    const ref = { table: "provider_credential", id: createId() };
    const sealed = await vault.seal(ws, ref, plaintext);

    expect(Buffer.from(sealed.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(sealed.authTag, "base64")).toHaveLength(16);
    expect(Buffer.from(sealed.ciphertext, "base64")).toHaveLength(
      Buffer.byteLength(plaintext),
    );
    expect(sealed.kekVersion).toBe("v7");
    expect(await vault.open(ws, ref, sealed)).toBe(plaintext);
  });

  it("refuses to open under another workspace, table or id", async () => {
    const ws = workspace();
    const other = workspace();
    const ref = { table: "provider_credential", id: createId() };
    const sealed = await vault.seal(ws, ref, plaintext);
    await vault.seal(other, ref, "provision-other-dek");

    for (const [w, r] of [
      [other, ref],
      [ws, { ...ref, id: createId() }],
      [ws, { ...ref, table: "tool_connection" }],
    ] as const) {
      await expect(vault.open(w, r, sealed)).rejects.toThrow(CryptoError);
    }
  });

  it("leaves the plaintext key in no column of the workspace's rows", async () => {
    const ws = workspace();
    const id = createId();
    const actor = randomUUID();
    const secret = await vault.seal(
      ws,
      { table: "provider_credential", id },
      plaintext,
    );
    await createCredentialRepo(db).insert(ws, {
      id,
      workspaceId: ws,
      providerId: "openai",
      alias: "main",
      last4: plaintext.slice(-4),
      baseUrl: null,
      status: "unchecked",
      createdBy: actor,
      archivedAt: null,
      secret,
    });
    await createAuditLogRepo(db).record(ws, {
      actorUserId: actor,
      action: "credential.created",
      targetType: "provider_credential",
      targetId: id,
      metadata: { alias: "main", providerId: "openai" },
    });

    const rows = await sql<{ text: string }[]>`
      select t::text as text from provider_credential t where workspace_id = ${ws}
      union all select t::text from audit_log t where workspace_id = ${ws}
      union all select t::text from workspace_key t where workspace_id = ${ws}`;
    expect(rows).toHaveLength(3);
    for (const { text } of rows) {
      expect(text).not.toContain(plaintext);
      expect(text).not.toContain(Buffer.from(plaintext).toString("base64"));
    }
  });
});
