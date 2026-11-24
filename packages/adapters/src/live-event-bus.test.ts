import { randomUUID } from "node:crypto";
import type { RunEvent } from "@middleware/contracts";
import { describe, expect, it } from "vitest";

import { createInMemoryLiveEventBus } from "./live-event-bus.ts";

const delta = (text: string): RunEvent => ({
  type: "message.delta",
  messageId: randomUUID(),
  text,
});

describe("in-memory live event bus", () => {
  it("fans an event out to every subscriber of the run", () => {
    const bus = createInMemoryLiveEventBus();
    const a: number[] = [];
    const b: number[] = [];
    const event = delta("hola");
    const offA = bus.subscribe("run-1", (m) => a.push(m.seq));
    bus.subscribe("run-1", (m) => b.push(m.seq));

    bus.publish("run-1", { seq: 1, event });
    offA();
    bus.publish("run-1", { seq: 2, event });

    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  it("keeps runs apart", () => {
    const bus = createInMemoryLiveEventBus();
    const seen: number[] = [];
    bus.subscribe("run-1", (m) => seen.push(m.seq));

    bus.publish("run-2", { seq: 1, event: delta("otro") });

    expect(seen).toEqual([]);
  });

  it("publishing with no subscriber is a no-op", () => {
    const bus = createInMemoryLiveEventBus();
    expect(() =>
      bus.publish("run-1", { seq: 1, event: delta("nadie") }),
    ).not.toThrow();
  });

  it("unsubscribe drops the set, and the run key can come back", () => {
    const bus = createInMemoryLiveEventBus();
    const seen: number[] = [];
    const off = bus.subscribe("run-1", (m) => seen.push(m.seq));
    off();
    off();

    bus.publish("run-1", { seq: 1, event: delta("x") });
    bus.subscribe("run-1", (m) => seen.push(m.seq));
    bus.publish("run-1", { seq: 2, event: delta("x") });

    expect(seen).toEqual([2]);
  });

  it("one throwing listener does not break the others or the publisher", () => {
    const bus = createInMemoryLiveEventBus();
    const seen: number[] = [];
    bus.subscribe("run-1", () => {
      throw new Error("broken subscriber");
    });
    bus.subscribe("run-1", (m) => seen.push(m.seq));

    expect(() =>
      bus.publish("run-1", { seq: 1, event: delta("x") }),
    ).not.toThrow();
    expect(seen).toEqual([1]);
  });
});
