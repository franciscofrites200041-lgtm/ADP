import { randomUUID } from "node:crypto";
import type { ConversationDraft } from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createConversationRepo } from "./conversation-repo.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable DB.
const url = process.env.DATABASE_URL_TEST;
if (url) {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" || u.pathname !== "/middleware_test") {
    throw new Error("Refusing to run against a non-disposable database");
  }
}

describe.skipIf(!url)("conversation repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const repo = createConversationRepo(drizzle(sql, { schema }));
  const workspaces: string[] = [];

  const workspace = () => {
    const id = randomUUID();
    workspaces.push(id);
    return id;
  };

  /** Conversations need a real agent row: the FK is not nullable. */
  const seedAgent = async (workspaceId: string) => {
    const agentId = createId();
    await sql`insert into agent (id, workspace_id, name)
      values (${agentId}, ${workspaceId}, 'agent')`;
    return agentId;
  };

  /** Caller-generated ids, so ordering tests can pin them. */
  const pinnedId = (n: number) =>
    `00000000-0000-7000-8000-${n.toString().padStart(12, "0")}`;

  const draft = async (
    workspaceId: string,
    id?: string,
    title: string | null = null,
  ): Promise<ConversationDraft> => ({
    id: id ?? createId(),
    agentId: await seedAgent(workspaceId),
    title,
  });

  afterAll(async () => {
    if (workspaces.length) {
      await sql`delete from message where workspace_id in ${sql(workspaces)}`;
      await sql`delete from usage_record
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from conversation
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from run where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent_version
        where workspace_id in ${sql(workspaces)}`;
      await sql`delete from agent where workspace_id in ${sql(workspaces)}`;
    }
    await sql.end();
  });

  it("inserts a conversation and reads it back", async () => {
    const ws = workspace();
    const inserted = await repo.insert(
      ws,
      await draft(ws, undefined, "charla"),
    );
    expect(inserted.workspaceId).toBe(ws);
    expect(inserted.title).toBe("charla");
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(inserted.updatedAt).toBeInstanceOf(Date);
    expect(inserted.archivedAt).toBeNull();
    expect(await repo.findById(ws, inserted.id)).toEqual(inserted);
  });

  it("treats another workspace's conversation as missing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const inserted = await repo.insert(ws, await draft(ws));
    expect(await repo.findById(other, inserted.id)).toBeNull();
  });

  it("refuses an agent from another workspace and writes nothing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const agentId = await seedAgent(other);

    await expect(
      repo.insert(ws, { id: createId(), agentId, title: null }),
    ).rejects.toThrow(NotFoundError);

    const [count] = await sql`select count(*)::int as n
      from conversation where workspace_id = ${ws}`;
    expect(count?.n).toBe(0);
  });

  it("lists newest first, hiding archived and foreign conversations", async () => {
    const ws = workspace();
    const other = workspace();
    const keep = await repo.insert(ws, await draft(ws, pinnedId(1), "keep"));
    const old = await repo.insert(ws, await draft(ws, pinnedId(2), "old"));
    await repo.insert(other, await draft(other, pinnedId(3), "foreign"));

    await repo.archive(ws, old.id, new Date());

    const visible = await repo.listByWorkspace(ws, {
      includeArchived: false,
    });
    expect(visible.map((conversation) => conversation.id)).toEqual([keep.id]);

    const everything = await repo.listByWorkspace(ws, {
      includeArchived: true,
    });
    expect(everything.map((conversation) => conversation.id)).toEqual([
      old.id,
      keep.id,
    ]);
    expect(everything[0]?.archivedAt).toBeInstanceOf(Date);
  });

  it("renames only inside the workspace and stamps updatedAt", async () => {
    const ws = workspace();
    const other = workspace();
    const inserted = await repo.insert(ws, await draft(ws, undefined, "antes"));

    const renamed = await repo.rename(ws, inserted.id, "después");
    expect(renamed?.title).toBe("después");
    // The rename stamp comes from the Node clock and insert's from the
    // database clock, which may drift: only sanity-check the stamp.
    expect(renamed?.updatedAt).toBeInstanceOf(Date);
    expect(
      Math.abs((renamed?.updatedAt.getTime() ?? 0) - Date.now()),
    ).toBeLessThan(5_000);

    expect(await repo.rename(other, inserted.id, "ajena")).toBeNull();
    expect(await repo.rename(ws, randomUUID(), "fantasma")).toBeNull();
    expect((await repo.findById(ws, inserted.id))?.title).toBe("después");
  });

  it("archives, and an archived conversation reads as missing", async () => {
    const ws = workspace();
    const other = workspace();
    const inserted = await repo.insert(ws, await draft(ws));
    const at = new Date();

    const archived = await repo.archive(ws, inserted.id, at);
    expect(archived?.archivedAt).toEqual(at);

    expect(await repo.findById(ws, inserted.id)).toBeNull();
    expect(await repo.rename(ws, inserted.id, "tarde")).toBeNull();
    expect(await repo.archive(other, inserted.id, at)).toBeNull();
    expect(await repo.archive(ws, randomUUID(), at)).toBeNull();
  });
});
