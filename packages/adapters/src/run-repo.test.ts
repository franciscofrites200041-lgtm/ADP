import { randomUUID } from "node:crypto";
import type { RunDraft } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createRunRepo } from "./run-repo.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("run repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const repo = createRunRepo(drizzle(sql, { schema }));
  const workspaces: string[] = [];

  const workspace = () => {
    const id = randomUUID();
    workspaces.push(id);
    return id;
  };

  /** Runs need real agent and version rows: the FKs are not nullable. */
  const seedAgent = async (workspaceId: string) => {
    const agentId = createId();
    const versionId = createId();
    await sql`insert into agent (id, workspace_id, name)
      values (${agentId}, ${workspaceId}, 'agent')`;
    await sql`insert into agent_version
      (id, agent_id, workspace_id, version, instructions, provider_id,
      model_id, params, tools)
      values (${versionId}, ${agentId}, ${workspaceId}, 1, 'instr',
      'openai', 'model-x', '{}', '[]')`;
    return { agentId, versionId };
  };

  const draft = async (workspaceId: string): Promise<RunDraft> => {
    const { agentId, versionId } = await seedAgent(workspaceId);
    return {
      id: createId(),
      workspaceId,
      agentId,
      agentVersionId: versionId,
      conversationId: null,
      trigger: "chat",
      input: "hola",
    };
  };

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

  it("inserts a queued root run and reads it back", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    expect(run.status).toBe("queued");
    expect(run.turnsCompleted).toBe(0);
    expect(run.checkpoint).toBeNull();
    expect(run.leaseUntil).toBeNull();
    expect(run.output).toBeNull();
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
    expect(run.queuedAt).toBeInstanceOf(Date);
    expect(await repo.findById(ws, run.id)).toEqual(run);
    const [row] =
      await sql`select root_run_id, trigger from run where id = ${run.id}`;
    expect(row?.root_run_id).toBe(run.id);
    expect(row?.trigger).toBe("chat");
  });

  it("treats another workspace's run as missing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const run = await repo.insert(ws, await draft(ws));
    expect(await repo.findById(other, run.id)).toBeNull();
  });

  it("one holder claims a live lease, another waits for expiry", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    const soon = new Date(Date.now() + 60_000);

    const claimed = await repo.claimLease(ws, run.id, soon);
    expect(claimed).toBe(true);
    const running = await repo.findById(ws, run.id);
    expect(running?.status).toBe("running");
    expect(running?.leaseUntil).toEqual(soon);
    expect(running?.startedAt).not.toBeNull();

    // Live lease: a second claimer loses.
    expect(
      await repo.claimLease(ws, run.id, new Date(Date.now() + 90_000)),
    ).toBe(false);

    // The holder renews, then lets the lease lapse: claimable again.
    const renewed = await repo.renewLease(ws, run.id, new Date(Date.now() - 1));
    expect(renewed?.leaseUntil).toBeInstanceOf(Date);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await repo.claimLease(ws, run.id, soon)).toBe(true);
    expect(await repo.claimLease(ws, run.id, soon)).toBe(false);
  });

  it("refuses a lease on a finished run", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    await repo.finish(ws, run.id, { status: "succeeded", output: "listo" });
    expect(
      await repo.claimLease(ws, run.id, new Date(Date.now() + 60_000)),
    ).toBe(false);
  });

  it("round-trips checkpoint and turns through saveProgress", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    const checkpoint = { turn: 2, history: ["a", "b"] };
    const saved = await repo.saveProgress(ws, run.id, {
      checkpoint,
      turnsCompleted: 2,
    });
    expect(saved?.checkpoint).toEqual(checkpoint);
    expect(saved?.turnsCompleted).toBe(2);
    expect((await repo.findById(ws, run.id))?.checkpoint).toEqual(checkpoint);
  });

  it("finish stamps the terminal state and drops the lease", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, run.id, new Date(Date.now() + 60_000));
    const failed = await repo.finish(ws, run.id, {
      status: "failed",
      errorCode: "provider_timeout",
      errorMessage: "el proveedor no respondió",
    });
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("provider_timeout");
    expect(failed?.errorMessage).toBe("el proveedor no respondió");
    expect(failed?.finishedAt).toBeInstanceOf(Date);
    expect(failed?.leaseUntil).toBeNull();

    const cancelled = await repo.insert(ws, await draft(ws));
    const done = await repo.finish(ws, cancelled.id, {
      status: "cancelled",
      output: null,
    });
    expect(done?.status).toBe("cancelled");
    expect(done?.output).toBeNull();
    expect(done?.errorCode).toBeNull();
  });

  it("listExpiredLeases returns only expired running runs", async () => {
    const ws = workspace();
    const expired = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, expired.id, new Date(Date.now() - 1000));
    const live = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, live.id, new Date(Date.now() + 60_000));
    const finished = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, finished.id, new Date(Date.now() - 1000));
    await repo.finish(ws, finished.id, { status: "succeeded", output: "ok" });
    const queued = await repo.insert(ws, await draft(ws));

    const stale = await repo.listExpiredLeases(new Date());
    expect(stale.map((run) => run.id)).toEqual([expired.id]);
    expect(stale[0]?.workspaceId).toBe(ws);
    void live;
    void queued;
  });

  it("listByWorkspace filters by status and scopes by workspace", async () => {
    const ws = workspace();
    const other = workspace();
    const succeeded = await repo.insert(ws, await draft(ws));
    await repo.finish(ws, succeeded.id, { status: "succeeded", output: "ok" });
    const failed = await repo.insert(ws, await draft(ws));
    await repo.finish(ws, failed.id, {
      status: "failed",
      errorCode: "unknown",
      errorMessage: "boom",
    });
    await repo.insert(ws, await draft(ws));
    await repo.insert(other, await draft(other));

    const all = await repo.listByWorkspace(ws, {});
    expect(all).toHaveLength(3);
    expect(
      (await repo.listByWorkspace(ws, { status: "succeeded" })).map(
        (r) => r.id,
      ),
    ).toEqual([succeeded.id]);
    expect(
      (await repo.listByWorkspace(ws, { status: "failed" })).map((r) => r.id),
    ).toEqual([failed.id]);
    expect(await repo.listByWorkspace(other, {})).toHaveLength(1);
  });
});
