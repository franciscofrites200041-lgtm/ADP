import { afterEach, describe, expect, it, vi } from "vitest";

import { registerShutdown } from "./shutdown.ts";

const logger = { info: vi.fn(), error: vi.fn() };

function harness(options: { closeFails?: boolean; graceMs?: number } = {}) {
  const events: string[] = [];
  const dispose: Array<() => void> = [];
  const exit = vi.fn((code: number) => void events.push(`exit:${code}`));
  const server = {
    close(callback: (error?: Error) => void) {
      events.push("server.close");
      callback();
    },
  };
  const close = vi.fn(async () => {
    events.push("close");
    if (options.closeFails) throw new Error("pool failed");
  });

  const detach = registerShutdown({
    server,
    close,
    logger,
    graceMs: options.graceMs ?? 100,
    exit,
  });
  dispose.push(detach);
  return { events, exit, close, dispose };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("registerShutdown", () => {
  it("stops the server, closes dependencies and exits 0", async () => {
    const h = harness();
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
    expect(h.events).toEqual(["server.close", "close", "exit:0"]);
    for (const fn of h.dispose) fn();
  });

  it("handles the second signal only once", async () => {
    const h = harness();
    process.emit("SIGTERM");
    process.emit("SIGINT");
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalled());
    expect(h.close).toHaveBeenCalledTimes(1);
    for (const fn of h.dispose) fn();
  });

  it("exits 1 when closing fails", async () => {
    const h = harness({ closeFails: true });
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1));
    for (const fn of h.dispose) fn();
  });

  it("exits 1 when the grace period expires", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const detach = registerShutdown({
      server: { close: () => {} },
      close: async () => new Promise<void>(() => {}),
      logger,
      graceMs: 60_000,
      exit,
    });
    process.emit("SIGTERM");
    vi.advanceTimersByTime(60_000);
    expect(exit).toHaveBeenCalledWith(1);
    detach();
    vi.useRealTimers();
  });
});
