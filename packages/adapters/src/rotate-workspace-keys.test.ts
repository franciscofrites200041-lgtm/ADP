import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createKeyring, generateDek, wrapDek } from "./envelope.ts";
import {
  rotateWorkspaceKeys,
  type WorkspaceKeyStore,
} from "./rotate-workspace-keys.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const currentWorkspaceId = "22222222-2222-4222-8222-222222222222";

describe("rotateWorkspaceKeys", () => {
  it("rewraps only old workspace DEKs and records the rotation time", async () => {
    const oldKey = randomBytes(32);
    const oldRing = createKeyring({ version: "v1", key: oldKey });
    const ring = createKeyring({
      version: "v2",
      key: randomBytes(32),
      previous: { v1: oldKey },
    });
    const oldDek = generateDek();
    const currentDek = generateDek();
    const oldRow = { workspaceId, ...wrapDek(oldRing, workspaceId, oldDek) };
    const currentRow = {
      workspaceId: currentWorkspaceId,
      ...wrapDek(ring, currentWorkspaceId, currentDek),
    };
    const updates: Array<{
      workspaceId: string;
      kekVersion: string;
      wrappedDek: string;
      rotatedAt: Date;
    }> = [];
    const store: WorkspaceKeyStore = {
      list: async () => [oldRow, currentRow],
      update: async (_expected, input) => {
        updates.push(input);
        return true;
      },
    };
    const rotatedAt = new Date("2026-10-29T15:00:00.000Z");

    const result = await rotateWorkspaceKeys({ ring, store, rotatedAt });

    expect(result).toEqual({ scanned: 2, rotated: 1, skipped: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      workspaceId,
      kekVersion: "v2",
      rotatedAt,
    });
    expect(updates[0]?.wrappedDek).not.toBe(oldRow.wrappedDek);
  });

  it("fails closed if a workspace key changes after it was read", async () => {
    const oldKey = randomBytes(32);
    const oldRing = createKeyring({ version: "v1", key: oldKey });
    const row = {
      workspaceId,
      ...wrapDek(oldRing, workspaceId, generateDek()),
    };
    const ring = createKeyring({
      version: "v2",
      key: randomBytes(32),
      previous: { v1: oldKey },
    });
    let expectedRow: unknown;
    const store: WorkspaceKeyStore = {
      list: async () => [row],
      update: async (expected) => {
        expectedRow = expected;
        return false;
      },
    };
    await expect(
      rotateWorkspaceKeys({ ring, store, rotatedAt: new Date() }),
    ).rejects.toMatchObject({ code: "WORKSPACE_KEY_CONFLICT" });
    expect(expectedRow).toEqual(row);
  });
});
