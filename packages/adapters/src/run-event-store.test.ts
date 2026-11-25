import { randomUUID } from "node:crypto";
import type { RunEvent } from "@middleware/contracts";
import type { RunDraft } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createRunEventStore } from "./run-event-store.ts";
import { createRunRepo } from "./run-repo.ts";

import { testDatabaseUrl } from "./testing/test-database-url.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable
// DB, validated in one shared place (ADR-0006).
const url = testDatabaseUrl();

describe.skipIf(!url)("run event store (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const db = drizzle(sql, { schema });
  const store = createRunEventStore(db);
  const repo = createRunRepo(db);
  const workspaces: string[] = [];

  const workspace = () => {
    const id = randomUUID();
    workspaces.push(id);
    return id;
  };

  const seedRun = async (workspaceId: string) => {
    const agentId = createId();
    const versionId = createId();
    await sql`insert into agent (id, workspace_id, name)
      values (${agentId}, ${workspaceId}, 'agent')`;
    await sql`insert into agent_version
      (id, agent_id, workspace_id, version, instructions, provider_id,
      model_id, params, tools)
      values (${versionId}, ${agentId}, ${workspaceId}, 1, 'instr',
      'openai', 'model-x', '{}', '[]')`;
    const draft: RunDraft = {
      id: createId(),
      workspaceId,
      agentId,
      agentVersionId: versionId,
      conversationId: null,
      trigger: "chat",
      input: "hola",
    };
    await repo.insert(workspaceId, draft);
    return draft.id;
  };

  const delta = (text: string): RunEvent => ({
    type: "message.delta",
    messageId: randomUUID(),
    text,
  });

  afterAll(async () => {
    if (workspaces.length) {
      await sql`delete from run_event where workspace_id in ${sql(workspaces)}`;
      await sql`delete from run where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent_version
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent
        where workspace_id in ${sql(workspaces)}`;
    }
    await sql.end();
  });

  it("appends consecutive seqs and reads them back", async () => {
    const ws = workspace();
    const runId = await seedRun(ws);
    const firstEvent = delta("a");
    const first = await store.append(ws, runId, [firstEvent, delta("b")]);
    expect(first.map((e) => e.seq)).toEqual([1, 2]);
    expect(first[0]?.event).toEqual(firstEvent);
    expect(first[0]?.createdAt).toBeInstanceOf(Date);

    const second = await store.append(ws, runId, [delta("c")]);
    expect(second.map((e) => e.seq)).toEqual([3]);
    expect((await store.listAfter(ws, runId, 0)).map((e) => e.seq)).toEqual([
      1, 2, 3,
    ]);
  });

  it("keeps seqs gap-free under two concurrent appends", async () => {
    const ws = workspace();
    const runId = await seedRun(ws);
    const batch = Array.from({ length: 10 }, (_, i) => delta(`t${i}`));
    const [a, b] = await Promise.all([
      store.append(ws, runId, batch),
      store.append(ws, runId, batch),
    ]);
    const seqs = [...a, ...b].map((e) => e.seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("listAfter returns only newer events and honours the limit", async () => {
    const ws = workspace();
    const runId = await seedRun(ws);
    await store.append(
      ws,
      runId,
      Array.from({ length: 5 }, (_, i) => delta(`t${i}`)),
    );
    const after = await store.listAfter(ws, runId, 3);
    expect(after.map((e) => e.seq)).toEqual([4, 5]);
    expect(await store.listAfter(ws, runId, 3, 1)).toHaveLength(1);
    expect(await store.listAfter(ws, runId, 5)).toEqual([]);
  });

  it("hides another workspace's events (cross-tenant, S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const runId = await seedRun(ws);
    await store.append(ws, runId, [delta("secreto")]);
    expect(await store.listAfter(other, runId, 0)).toEqual([]);
  });
});
