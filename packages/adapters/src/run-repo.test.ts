import { randomUUID } from "node:crypto";
import type { RunCheckpoint } from "@middleware/contracts";
import type { Run, RunDraft } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { InvariantError } from "./errors.ts";
import { createRunRepo, createRunSweeper } from "./run-repo.ts";

import { testDatabaseUrl } from "./testing/test-database-url.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable
// DB, validated in one shared place (ADR-0006).
const url = testDatabaseUrl();

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
    // The contract shape: the transcript a resume streams from (WP-50).
    const checkpoint: RunCheckpoint = {
      transcript: [
        { role: "user", text: "hola" },
        { role: "assistant", text: "listo" },
      ],
    };
    const saved = await repo.saveProgress(ws, run.id, {
      checkpoint,
      turnsCompleted: 2,
    });
    expect(saved?.checkpoint).toEqual(checkpoint);
    expect(saved?.turnsCompleted).toBe(2);
    expect((await repo.findById(ws, run.id))?.checkpoint).toEqual(checkpoint);
  });

  it("rejects a checkpoint that does not honour the contract", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    // Every method reads back through the boundary, so a row that does not
    // parse fails loudly at the call, never as a silent `undefined`.
    await expect(
      repo.saveProgress(ws, run.id, {
        checkpoint: { turn: 2, history: ["a"] },
        turnsCompleted: 2,
      }),
    ).rejects.toThrow(InvariantError);
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

  it("finish refuses to overwrite a terminal row with another terminal state (S11)", async () => {
    const ws = workspace();
    const run = await repo.insert(ws, await draft(ws));
    const cancelled = await repo.finish(ws, run.id, {
      status: "cancelled",
      output: null,
    });
    expect(cancelled?.status).toBe("cancelled");

    // A later, different terminal state changes nothing — and the caller
    // can tell: the port answers null, not the row it refused to write.
    const overwritten = await repo.finish(ws, run.id, {
      status: "failed",
      errorCode: "run_timeout",
      errorMessage: "run_timeout",
    });
    expect(overwritten).toBeNull();

    const row = await repo.findById(ws, run.id);
    expect(row?.status).toBe("cancelled");
    expect(row?.output).toBeNull();
    expect(row?.errorCode).toBeNull();
    expect(row?.errorMessage).toBeNull();
    expect(row?.finishedAt).toEqual(cancelled?.finishedAt);
  });

  it("insertWithinLimit admits the 5th unfinished run and refuses the 6th (S10)", async () => {
    const ws = workspace();
    for (let i = 0; i < 4; i += 1) {
      const run = await repo.insert(ws, await draft(ws));
      await repo.claimLease(ws, run.id, new Date(Date.now() + 60_000));
    }

    const fifth = await repo.insertWithinLimit(ws, await draft(ws), 5);
    expect(fifth?.status).toBe("queued");
    expect(await repo.insertWithinLimit(ws, await draft(ws), 5)).toBeNull();

    // A finished run no longer counts: its slot frees up.
    await repo.finish(ws, fifth?.id ?? "", {
      status: "succeeded",
      output: "listo",
    });
    expect(await repo.insertWithinLimit(ws, await draft(ws), 5)).not.toBeNull();
  });

  it("insertWithinLimit: racing starts cannot all pass (S10)", async () => {
    const ws = workspace();
    for (let i = 0; i < 4; i += 1) {
      const run = await repo.insert(ws, await draft(ws));
      await repo.claimLease(ws, run.id, new Date(Date.now() + 60_000));
    }
    // One slot left, several concurrent contenders: every racing pair among
    // them must not both pass. Without the per-workspace lock, two counts
    // could both see room under READ COMMITTED and both insert.
    const contenders = await Promise.all(
      Array.from({ length: 8 }, () => draft(ws)),
    );
    const outcomes = await Promise.all(
      contenders.map((candidate) => repo.insertWithinLimit(ws, candidate, 5)),
    );

    const winners = outcomes.filter((run) => run !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.status).toBe("queued");
    const [counted] = await sql`select count(*)::int as total from run
        where workspace_id = ${ws}`;
    expect(counted?.total).toBe(5);
  });

  it("insertWithinLimit waits for the workspace lock before counting (S10)", async () => {
    // The racing test above is a smoke: it can pass by luck, because two
    // fast transactions may never overlap. This one is deterministic — it
    // holds the per-workspace advisory lock on another connection, so the
    // cap check cannot run until that lock is released. Without the lock the
    // insert goes straight through and the race below answers `inserted`.
    const ws = workspace();
    const candidate = await draft(ws);
    const blocker = postgres(url ?? "", { max: 1 });
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${ws}))`;
        pending = repo.insertWithinLimit(ws, candidate, 5);
        const raced = await Promise.race([
          pending.then(() => "inserted" as const),
          new Promise<"blocked">((resolve) =>
            setTimeout(() => resolve("blocked"), 400),
          ),
        ]);
        expect(raced).toBe("blocked");
      });
    } finally {
      await blocker.end();
    }
    // The lock only serializes: once released, the same start completes.
    expect(await pending).not.toBeNull();
  });

  it("one holder claims a live lease even when two connections race (§5)", async () => {
    const ws = workspace();
    // Two separate sessions: a shared pool could serialize the claims and
    // hide a read-then-write race.
    const sqlA = postgres(url ?? "", { max: 1 });
    const sqlB = postgres(url ?? "", { max: 1 });
    try {
      const repoA = createRunRepo(drizzle(sqlA, { schema }));
      const repoB = createRunRepo(drizzle(sqlB, { schema }));
      const runs: Run[] = [];
      for (let i = 0; i < 10; i += 1) {
        runs.push(await repo.insert(ws, await draft(ws)));
      }
      const soon = new Date(Date.now() + 60_000);

      const claims = await Promise.all(
        runs.flatMap((run) => [
          repoA.claimLease(ws, run.id, soon),
          repoB.claimLease(ws, run.id, soon),
        ]),
      );

      // Exactly one winner per run: a SELECT-then-UPDATE implementation
      // that reads the lease outside the row-locking UPDATE would let both
      // connections claim the same run.
      expect(claims.filter(Boolean)).toHaveLength(runs.length);
      const live = await repo.findById(ws, runs[0]?.id ?? "");
      expect(live?.status).toBe("running");
    } finally {
      await sqlA.end();
      await sqlB.end();
    }
  });

  it("sweep listExpiredLeases returns only expired running runs, as id pairs", async () => {
    const sweeper = createRunSweeper(drizzle(sql, { schema }));
    const ws = workspace();
    const expired = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, expired.id, new Date(Date.now() - 1000));
    const live = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, live.id, new Date(Date.now() + 60_000));
    const finished = await repo.insert(ws, await draft(ws));
    await repo.claimLease(ws, finished.id, new Date(Date.now() - 1000));
    await repo.finish(ws, finished.id, { status: "succeeded", output: "ok" });
    const queued = await repo.insert(ws, await draft(ws));

    const stale = await sweeper.listExpiredLeases(new Date());
    // Only this file's rows: the sweep is system-wide, and other suites run
    // against the same database.
    const ownIds = stale
      .filter((pair) => pair.workspaceId === ws)
      .map((pair) => pair.runId);
    expect(ownIds).toEqual([expired.id]);
    // A live lease and every non-running run are invisible to the sweep.
    expect(ownIds).not.toContain(live.id);
    expect(ownIds).not.toContain(finished.id);
    expect(ownIds).not.toContain(queued.id);
  });

  describe("cross-tenant writes are refused (S4)", () => {
    /** A claimed run in `ws`, with a foreign workspace ready to attack. */
    const seedRunning = async () => {
      const ws = workspace();
      const foreign = workspace();
      const run = await repo.insert(ws, await draft(ws));
      const leaseUntil = new Date(Date.now() + 60_000);
      await repo.claimLease(ws, run.id, leaseUntil);
      return { ws, foreign, run, leaseUntil };
    };

    it("claimLease: returns false and the lease stays as it was", async () => {
      const { ws, foreign, run, leaseUntil } = await seedRunning();

      const claimed = await repo.claimLease(
        foreign,
        run.id,
        new Date(Date.now() + 120_000),
      );
      expect(claimed).toBe(false);

      const row = await repo.findById(ws, run.id);
      expect(row?.status).toBe("running");
      expect(row?.leaseUntil?.getTime()).toBe(leaseUntil.getTime());
    });

    it("renewLease: no effect on the row", async () => {
      const { ws, foreign, run, leaseUntil } = await seedRunning();

      const renewed = await repo.renewLease(
        foreign,
        run.id,
        new Date(Date.now() + 120_000),
      );
      expect(renewed).toBeNull();

      const row = await repo.findById(ws, run.id);
      expect(row?.leaseUntil?.getTime()).toBe(leaseUntil.getTime());
    });

    it("saveProgress: checkpoint and turnsCompleted unchanged", async () => {
      const { ws, foreign, run } = await seedRunning();
      await repo.saveProgress(ws, run.id, {
        checkpoint: { transcript: [{ role: "user", text: "hola" }] },
        turnsCompleted: 3,
      });

      const progress: RunCheckpoint = {
        transcript: [{ role: "user", text: "inyección" }],
      };
      const saved = await repo.saveProgress(foreign, run.id, {
        checkpoint: progress,
        turnsCompleted: 99,
      });
      expect(saved).toBeNull();

      const row = await repo.findById(ws, run.id);
      expect(row?.turnsCompleted).toBe(3);
      expect(row?.checkpoint).toEqual({
        transcript: [{ role: "user", text: "hola" }],
      });
    });

    it("finish: status and finishedAt unchanged", async () => {
      const { ws, foreign, run, leaseUntil } = await seedRunning();

      const finished = await repo.finish(foreign, run.id, {
        status: "cancelled",
        output: null,
      });
      expect(finished).toBeNull();

      const row = await repo.findById(ws, run.id);
      expect(row?.status).toBe("running");
      expect(row?.finishedAt).toBeNull();
      expect(row?.output).toBeNull();
      expect(row?.leaseUntil?.getTime()).toBe(leaseUntil.getTime());
    });

    it("listByWorkspace: returns nothing for a foreign workspace", async () => {
      const { ws, foreign, run } = await seedRunning();

      const listed = await repo.listByWorkspace(foreign, {});
      expect(listed).toEqual([]);
      // And the owner still sees its own row.
      expect((await repo.listByWorkspace(ws, {})).map((row) => row.id)).toEqual(
        [run.id],
      );
    });
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

  it("listByWorkspace filters by agent in the query, not after the page", async () => {
    const ws = workspace();
    const wanted = await repo.insert(ws, await draft(ws));
    // Newer, so it is the only row a `limit: 1` page would contain. If the
    // filter ran after the page cut, asking for `wanted.agentId` would come
    // back empty and older runs would vanish behind other agents' rows.
    const newer = await repo.insert(ws, await draft(ws));
    expect(newer.agentId).not.toBe(wanted.agentId);

    const filtered = await repo.listByWorkspace(ws, {
      agentId: wanted.agentId,
      limit: 1,
    });
    expect(filtered.map((r) => r.id)).toEqual([wanted.id]);
  });
});
