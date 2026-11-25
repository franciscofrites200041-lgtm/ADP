import type { CreateRunRequest, RunEvent } from "@middleware/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openRunStream, type RunStreamEnd } from "./run-stream.ts";

const RUN_ID = "0190a5f2-0000-7000-8000-00000000000a";
const VERSION_ID = "0190a5f2-0000-7000-8000-00000000000b";
const MESSAGE_ID = "0190a5f2-0000-7000-8000-00000000000c";
const AGENT_ID = "0190a5f2-0000-7000-8000-00000000000d";
const CONVERSATION_ID = "0190a5f2-0000-7000-8000-00000000000e";

const body: CreateRunRequest = {
  agentId: AGENT_ID,
  conversationId: CONVERSATION_ID,
  input: "hola",
};

const started = (): RunEvent => ({
  type: "run.started",
  runId: RUN_ID,
  agentVersionId: VERSION_ID,
  model: "test-model",
});

const delta = (text: string): RunEvent => ({
  type: "message.delta",
  messageId: MESSAGE_ID,
  text,
});

const completed = (content: string): RunEvent => ({
  type: "message.completed",
  messageId: MESSAGE_ID,
  content,
});

const done = (): RunEvent => ({
  type: "run.completed",
  output: "Hola",
  finishedAt: new Date().toISOString(),
});

/** The exact wire format of `sseFrame`: three lines plus the blank line. */
const frame = (seq: number, event: RunEvent): string =>
  `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const sseResponse = (frames: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of frames) controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    { status: 200 },
  );
};

const hangingStream = (frames: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of frames) controller.enqueue(encoder.encode(text));
      },
    }),
    { status: 200 },
  );
};

type Call = { url: string; lastEventId: string | null };

const recorder = (responses: Response[]) => {
  const calls: Call[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: input.toString(),
        lastEventId: headers.get("last-event-id"),
      });
      const next = responses.shift();
      return next ?? sseResponse([]);
    },
  );
  return { calls, fetchMock };
};

interface Capture {
  events: RunEvent[];
  seqs: number[];
  ended: Promise<RunStreamEnd>;
  resolve: (end: RunStreamEnd) => void;
}

const capture = (): Capture => {
  const bucket: { resolve?: (end: RunStreamEnd) => void } = {};
  return {
    events: [],
    seqs: [],
    ended: new Promise<RunStreamEnd>((resolve) => {
      bucket.resolve = resolve;
    }),
    resolve: (end) => bucket.resolve?.(end),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openRunStream", () => {
  it("emits the frames in order and ends at the terminal event", async () => {
    const { calls, fetchMock } = recorder([
      sseResponse([
        frame(1, started()),
        frame(2, delta("Hol")),
        frame(3, delta("a")),
        frame(4, completed("Hola")),
        frame(5, done()),
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const observed = capture();
    const controller = new AbortController();
    const handle = openRunStream(
      { kind: "create", body },
      {
        onEvent: (event, seq) => {
          observed.events.push(event);
          observed.seqs.push(seq);
        },
        onEnd: observed.resolve,
      },
      controller.signal,
    );
    expect(handle).toBeDefined();
    const end = await observed.ended;

    expect(observed.seqs).toEqual([1, 2, 3, 4, 5]);
    const text = observed.events
      .filter((event) => event.type === "message.delta")
      .map((event) => (event.type === "message.delta" ? event.text : ""))
      .join("");
    expect(text).toBe("Hola");
    expect(end).toEqual({ kind: "terminal" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.endsWith("/api/runs")).toBe(true);
  });

  it("reconnects with Last-Event-ID and never replays shown text", async () => {
    const { calls, fetchMock } = recorder([
      // The POST stream drops after two deltas, without a terminal event.
      sseResponse([
        frame(1, started()),
        frame(2, delta("Hol")),
        frame(3, delta("a")),
      ]),
      // The reconnect replays overlapping frames (S6 allows it); the reader
      // must apply each sequence only once.
      sseResponse([
        frame(2, delta("Hol")),
        frame(3, delta("a")),
        frame(4, delta("!")),
        frame(5, done()),
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const observed = capture();
    const controller = new AbortController();
    openRunStream(
      { kind: "create", body },
      {
        onEvent: (event, seq) => {
          observed.events.push(event);
          observed.seqs.push(seq);
        },
        onEnd: observed.resolve,
      },
      controller.signal,
      { reconnectMs: 1 },
    );
    const end = await observed.ended;

    const text = observed.events
      .filter((event) => event.type === "message.delta")
      .map((event) => (event.type === "message.delta" ? event.text : ""))
      .join("");
    expect(text).toBe("Hola!");
    expect(end).toEqual({ kind: "terminal" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe(`/api/runs/${RUN_ID}/events`);
    expect(calls[1]?.lastEventId).toBe("3");
  });

  it("surfaces the API's Spanish message when the create call fails", async () => {
    const { fetchMock } = recorder([
      new Response(
        JSON.stringify({
          error: { code: "invalid_request", message: "La key no funciona." },
        }),
        { status: 400 },
      ),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const observed = capture();
    openRunStream(
      { kind: "create", body },
      { onEvent: () => {}, onEnd: observed.resolve },
      new AbortController().signal,
    );
    const end = await observed.ended;

    expect(end).toEqual({ kind: "failed", message: "La key no funciona." });
  });

  it("stops instead of spinning forever when a dead run never streams", async () => {
    const { fetchMock } = recorder([
      sseResponse([]),
      sseResponse([]),
      sseResponse([]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const observed = capture();
    openRunStream(
      { kind: "replay", runId: RUN_ID },
      { onEvent: () => {}, onEnd: observed.resolve },
      new AbortController().signal,
      { reconnectMs: 1, maxDurationMs: 10 },
    );
    const end = await observed.ended;

    expect(end).toEqual({ kind: "failed", message: null });
  });

  it("reports an abort and stops reading the stream", async () => {
    const { fetchMock } = recorder([hangingStream([frame(1, started())])]);
    vi.stubGlobal("fetch", fetchMock);

    const observed = capture();
    const controller = new AbortController();
    const handle = openRunStream(
      { kind: "create", body },
      { onEvent: () => {}, onEnd: observed.resolve },
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.abort();

    expect(await observed.ended).toEqual({ kind: "aborted" });
  });
});
