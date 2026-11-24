import { randomUUID } from "node:crypto";
import type { RunDraft, UsageRecordDraft } from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createRunRepo } from "./run-repo.ts";
import { createUsageRepo } from "./usage-repo.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("usage repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const repo = createUsageRepo(drizzle(sql, { schema }));
  const runs = createRunRepo(drizzle(sql, { schema }));
  const workspaces: string[] = [];

  const workspace = () => {
    const id = randomUUID();
    workspaces.push(id);
    return id;
  };

  /** Usage rows need real agent, version and run rows: the FKs are hard. */
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
    return { ...(await runs.insert(workspaceId, draft)), agentId };
  };

  afterAll(async () => {
    if (workspaces.length) {
      await sql`delete from usage_record
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from run_event where workspace_id in ${sql(workspaces)}`;
      await sql`delete from run where workspace_id in ${sql(workspaces)}`;
      await sql`delete from conversation
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent_version
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent where workspace_id in ${sql(workspaces)}`;
    }
    await sql.end();
  });

  it("stores exactly the given token fields and the numeric cost", async () => {
    const ws = workspace();
    const { agentId, id: runId } = await seedRun(ws);
    const draft: UsageRecordDraft = {
      runId,
      agentId,
      providerId: "openai",
      modelId: "gpt-4o-mini",
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      costUsd: 0.0025,
    };

    const record = await repo.insert(ws, draft);
    expect(record.id).toBeDefined();
    expect(record.workspaceId).toBe(ws);
    expect(record.runId).toBe(runId);
    expect(record.agentId).toBe(agentId);
    expect(record.providerId).toBe("openai");
    expect(record.modelId).toBe("gpt-4o-mini");
    expect(record.inputTokens).toBe(120);
    expect(record.outputTokens).toBe(45);
    expect(record.cacheReadTokens).toBe(10);
    expect(record.cacheWriteTokens).toBe(0);
    expect(record.costUsd).toBe(0.0025);
    expect(record.createdAt).toBeInstanceOf(Date);

    const [row] = await sql`select * from usage_record where id = ${record.id}`;
    expect(row?.workspace_id).toBe(ws);
    expect(row?.input_tokens).toBe(120);
    expect(row?.cache_write_tokens).toBe(0);
    expect(row?.cost_usd).toBe("0.002500");
  });

  it("refuses a foreign run or agent and writes nothing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const own = await seedRun(ws);
    const foreign = await seedRun(other);
    const base = {
      providerId: "openai",
      modelId: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };

    // Both foreign: the run check fails first, same error either way.
    await expect(
      repo.insert(ws, {
        ...base,
        runId: foreign.id,
        agentId: foreign.agentId,
      }),
    ).rejects.toThrow(NotFoundError);

    // Own agent, foreign run: the run must belong to the workspace.
    await expect(
      repo.insert(ws, { ...base, runId: foreign.id, agentId: own.agentId }),
    ).rejects.toThrow(NotFoundError);

    // Own run, foreign agent: the agent must belong to the workspace.
    await expect(
      repo.insert(ws, { ...base, runId: own.id, agentId: foreign.agentId }),
    ).rejects.toThrow(NotFoundError);

    const [count] = await sql`select count(*)::int as n
      from usage_record where workspace_id = ${ws}`;
    expect(count?.n).toBe(0);
  });

  it("rejects invalid drafts at the boundary", async () => {
    const ws = workspace();
    const { agentId, id: runId } = await seedRun(ws);
    const base = {
      runId,
      agentId,
      providerId: "openai",
      modelId: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };
    for (const draft of [
      { ...base, costUsd: Number.NaN },
      { ...base, costUsd: Number.POSITIVE_INFINITY },
      { ...base, costUsd: -0.01 },
      { ...base, inputTokens: -1 },
      { ...base, outputTokens: 1.5 },
      { ...base, cacheReadTokens: Number.NaN },
    ]) {
      await expect(repo.insert(ws, draft)).rejects.toThrow();
    }
  });
});
