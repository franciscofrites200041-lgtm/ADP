import { randomUUID } from "node:crypto";
import { schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createAuditLogRepo } from "./audit-log-repo.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("audit log repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 2 });
  const audit = createAuditLogRepo(drizzle(sql, { schema }));
  const created: string[] = [];

  afterAll(async () => {
    if (created.length)
      await sql`delete from audit_log where workspace_id in ${sql(created)}`;
    await sql.end();
  });

  it("records one row in the given workspace", async () => {
    const ws = randomUUID();
    created.push(ws);
    const entry = {
      actorUserId: randomUUID(),
      action: "credential.renamed",
      targetType: "provider_credential",
      targetId: randomUUID(),
      metadata: { alias: "backup" },
    };
    await audit.record(ws, entry);

    const rows = await sql`
      select actor_user_id, action, target_type, target_id, metadata, actor_token_id
      from audit_log where workspace_id = ${ws}`;
    expect(rows).toEqual([
      {
        actor_user_id: entry.actorUserId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        metadata: entry.metadata,
        actor_token_id: null,
      },
    ]);
  });
});
