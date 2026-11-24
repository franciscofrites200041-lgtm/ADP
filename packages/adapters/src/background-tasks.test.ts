import { describe, expect, it } from "vitest";

import { createBackgroundTasks } from "./background-tasks.ts";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("background tasks", () => {
  it("tracks a task and drain waits for it", async () => {
    const tasks = createBackgroundTasks();
    let ran = false;
    await tasks.track(async () => {
      await sleep(10);
      ran = true;
    });
    expect(ran).toBe(true);
    expect(await tasks.drain(1000)).toBe(true);
  });

  it("drain returns false when the timeout beats the task", async () => {
    const tasks = createBackgroundTasks();
    tasks.track(async () => {
      await sleep(150);
    });
    expect(await tasks.drain(10)).toBe(false);
    // The task keeps running: a later drain with room still reports true.
    expect(await tasks.drain(1000)).toBe(true);
  });

  it("drain with nothing tracked returns true immediately", async () => {
    const tasks = createBackgroundTasks();
    expect(await tasks.drain(0)).toBe(true);
  });

  it("propagates the task rejection to the caller of track", async () => {
    const tasks = createBackgroundTasks();
    const failure = tasks.track(async () => {
      throw new Error("boom");
    });
    await expect(failure).rejects.toThrow("boom");
    expect(await tasks.drain(100)).toBe(true);
  });
});
