import { randomUUID } from "node:crypto";
import type { MessageDraft, MessageRole, RunDraft } from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { createId, schema } from "@middleware/db";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createConversationRepo } from "./conversation-repo.ts";
import {
  createMessageRepo,
  decodeMessageCursor,
  encodeMessageCursor,
  MessageCursorError,
} from "./message-repo.ts";
import { createRunRepo } from "./run-repo.ts";

import { testDatabaseUrl } from "./testing/test-database-url.ts";

// Opt-in: only runs with DATABASE_URL_TEST, and only against the disposable
// DB, validated in one shared place (ADR-0006).
const url = testDatabaseUrl();

describe("message cursor", () => {
  const anchor = {
    createdAt: "2026-02-03 04:05:06.789123+00",
    id: randomUUID(),
  };

  it("round-trips the (createdAt, id) pair", () => {
    const encoded = encodeMessageCursor(anchor);
    // Opaque: the raw values never show through.
    expect(encoded).not.toContain(anchor.createdAt);
    expect(encoded).not.toContain(anchor.id);
    expect(decodeMessageCursor(encoded)).toEqual(anchor);
  });

  it("rejects a malformed cursor with a typed error", () => {
    const malformed = [
      "",
      "not a cursor",
      Buffer.from("not json").toString("base64url"),
      Buffer.from(JSON.stringify({ t: 123 })).toString("base64url"),
      Buffer.from(
        JSON.stringify({ t: "2026-02-03 04:05:06.789123+00" }),
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ t: "2026-02-03 04:05:06.789123+00", id: "nope" }),
      ).toString("base64url"),
    ];
    for (const cursor of malformed) {
      try {
        decodeMessageCursor(cursor);
        expect.unreachable("expected decodeMessageCursor to throw");
      } catch (caught) {
        // Narrowing instead of a cast: anything else rethrows.
        if (!(caught instanceof MessageCursorError)) throw caught;
        expect(caught.code).toBe("invalid_request");
        expect(caught.message).toBe("malformed_cursor");
      }
    }
  });
});

describe.skipIf(!url)("message repo (postgres)", () => {
  const sql = postgres(url ?? "", { max: 5 });
  const db = drizzle(sql, { schema });
  const messages = createMessageRepo(db);
  const conversations = createConversationRepo(db);
  const runs = createRunRepo(db);
  const workspaces: string[] = [];

  const workspace = () => {
    const id = randomUUID();
    workspaces.push(id);
    return id;
  };

  /** Messages need real agent, version, conversation and run rows (FKs). */
  const seedConversation = async (workspaceId: string) => {
    const agentId = createId();
    const versionId = createId();
    await sql`insert into agent (id, workspace_id, name)
      values (${agentId}, ${workspaceId}, 'agent')`;
    await sql`insert into agent_version
      (id, agent_id, workspace_id, version, instructions, provider_id,
      model_id, params, tools)
      values (${versionId}, ${agentId}, ${workspaceId}, 1, 'instr',
      'openai', 'model-x', '{}', '[]')`;
    const conversation = await conversations.insert(workspaceId, {
      id: createId(),
      agentId,
      title: null,
    });
    return { agentId, versionId, conversationId: conversation.id };
  };

  const seedRun = async (
    workspaceId: string,
    agentId: string,
    versionId: string,
    conversationId: string | null,
  ) => {
    const draft: RunDraft = {
      id: createId(),
      workspaceId,
      agentId,
      agentVersionId: versionId,
      conversationId,
      trigger: "chat",
      input: "hola",
    };
    return runs.insert(workspaceId, draft);
  };

  const draft = (
    conversationId: string,
    role: MessageRole,
    content: string,
    runId: string | null = null,
  ): MessageDraft => ({
    id: createId(),
    conversationId,
    runId,
    role,
    content,
  });

  afterAll(async () => {
    if (workspaces.length) {
      await sql`delete from message where workspace_id in ${sql(workspaces)}`;
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

  it("appends messages and lists them in ascending creation order", async () => {
    const ws = workspace();
    const { agentId, versionId, conversationId } = await seedConversation(ws);
    const run = await seedRun(ws, agentId, versionId, conversationId);

    const user = await messages.append(
      ws,
      draft(conversationId, "user", "hola"),
    );
    const assistant = await messages.append(
      ws,
      draft(conversationId, "assistant", "¡hola!", run.id),
    );

    // A user message exists before its run: runId may be null (S1), and a
    // real run id is accepted.
    expect(user.runId).toBeNull();
    expect(assistant.runId).toBe(run.id);
    expect(assistant.content).toBe("¡hola!");

    const page = await messages.listByConversation(ws, conversationId, {
      limit: 10,
    });
    expect(page.messages.map((message) => message.id)).toEqual([
      user.id,
      assistant.id,
    ]);
    expect(page.messages[0]?.workspaceId).toBe(ws);
    expect(page.messages[0]?.role).toBe("user");
    expect(page.nextCursor).toBeNull();
  });

  it("pages with the cursor without gaps or repeats", async () => {
    const ws = workspace();
    const { conversationId } = await seedConversation(ws);
    const appended: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const message = await messages.append(
        ws,
        draft(conversationId, "user", `m${i}`),
      );
      appended.push(message.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await messages.listByConversation(ws, conversationId, {
        limit: 3,
        ...(cursor === null ? {} : { after: cursor }),
      });
      seen.push(...page.messages.map((message) => message.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    expect(seen).toEqual(appended);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("pages deterministically when several messages share a timestamp", async () => {
    const ws = workspace();
    const { conversationId } = await seedConversation(ws);
    for (let i = 0; i < 4; i += 1) {
      await messages.append(ws, draft(conversationId, "user", `m${i}`));
    }
    // One statement, one `now()`: every row gets the exact same timestamp.
    const same = new Date("2026-02-03T04:05:06.789Z");
    await sql`update message set created_at = ${same.toISOString()}::timestamptz
      where conversation_id = ${conversationId}`;

    const first = await messages.listByConversation(ws, conversationId, {
      limit: 1,
    });
    if (!first.nextCursor) throw new Error("expected a next cursor");
    const second = await messages.listByConversation(ws, conversationId, {
      limit: 10,
      after: first.nextCursor,
    });

    const ids = [
      ...first.messages.map((message) => message.id),
      ...second.messages.map((message) => message.id),
    ];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    // Same timestamp for all: the tie breaks by id, on both pages.
    expect(ids).toEqual([...ids].sort());
    for (const message of [...first.messages, ...second.messages]) {
      expect(message.createdAt.getTime()).toBe(same.getTime());
    }
  });

  it("refuses a run id from another workspace and writes nothing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const { conversationId } = await seedConversation(ws);
    const foreign = await seedConversation(other);
    const run = await seedRun(other, foreign.agentId, foreign.versionId, null);

    await expect(
      messages.append(ws, draft(conversationId, "assistant", "ajeno", run.id)),
    ).rejects.toThrow(NotFoundError);

    const [count] = await sql`select count(*)::int as n
      from message where conversation_id = ${conversationId}`;
    expect(count?.n).toBe(0);
  });

  it("rejects an out-of-range page size at the boundary", async () => {
    const ws = workspace();
    const { conversationId } = await seedConversation(ws);
    await messages.append(ws, draft(conversationId, "user", "hola"));
    for (const limit of [0, -1, 1.5, Number.POSITIVE_INFINITY, 1001]) {
      await expect(
        messages.listByConversation(ws, conversationId, { limit }),
      ).rejects.toThrow();
    }
  });

  it("shows nothing to another workspace, whose appends read as missing (S4)", async () => {
    const ws = workspace();
    const other = workspace();
    const { conversationId } = await seedConversation(ws);
    await messages.append(ws, draft(conversationId, "user", "hola"));

    const page = await messages.listByConversation(other, conversationId, {
      limit: 10,
    });
    expect(page.messages).toEqual([]);
    expect(page.nextCursor).toBeNull();

    await expect(
      messages.append(other, draft(conversationId, "user", "ajeno")),
    ).rejects.toThrow(NotFoundError);
  });
});
