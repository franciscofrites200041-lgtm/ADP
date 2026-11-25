import {
  type CreateRunRequest,
  type RunEvent,
  runEventSchema,
} from "@middleware/contracts";

import { apiErrorMessage } from "../../../shared/api-client.ts";

/**
 * The chat's own SSE reader (§11): `EventSource` cannot POST, so the run
 * starts over `fetch` and the response body is read frame by frame. While the
 * connection is up, each frame carries its store `seq` as the SSE id. When the
 * connection drops before the terminal event, the reader reconnects to
 * `GET /api/runs/:id/events` with `Last-Event-ID` (S6), and a sequence that
 * was already applied is never applied again — so a replayed frame cannot
 * duplicate text the user already saw.
 */

export type RunStreamStart =
  | { kind: "create"; body: CreateRunRequest }
  | { kind: "replay"; runId: string };

export type RunStreamEnd =
  | { kind: "terminal" }
  | { kind: "aborted" }
  | { kind: "failed"; message: string | null };

export interface RunStreamHandlers {
  onEvent: (event: RunEvent, seq: number) => void;
  onEnd: (end: RunStreamEnd) => void;
}

export interface RunStreamOptions {
  /** Sequences at or below this were already applied: they are skipped. */
  fromSeq?: number;
  reconnectMs?: number;
  /** Hard budget: S10 caps an interactive run at ten minutes. */
  maxDurationMs?: number;
}

export interface RunStreamHandle {
  abort(): void;
}

const TERMINAL_EVENTS: ReadonlySet<RunEvent["type"]> = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

const DEFAULT_RECONNECT_MS = 1000;
const DEFAULT_MAX_DURATION_MS = 11 * 60 * 1000;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Extracts the API's Spanish message from a JSON error body, or null. */
const failureMessage = async (response: Response): Promise<string | null> => {
  const body: unknown = await response.json().catch(() => null);
  const message = apiErrorMessage(body, "");
  return message === "" ? null : message;
};

export function openRunStream(
  start: RunStreamStart,
  handlers: RunStreamHandlers,
  signal: AbortSignal,
  options: RunStreamOptions = {},
): RunStreamHandle {
  // The fetches ride an internal signal: the caller's signal (unmount) and
  // `handle.abort()` both stop the stream, each from its own side.
  const internal = new AbortController();
  signal.addEventListener("abort", () => internal.abort(), { once: true });
  const reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const deadline = Date.now() + maxDurationMs;
  let lastSeq = options.fromSeq ?? 0;
  /** The reader currently blocked in `read()`: aborting must unblock it. */
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Set by `run.started` on the create path; it enables the GET reconnect. */
  let runId: string | null = start.kind === "replay" ? start.runId : null;
  // The create call happens at most once: reconnecting would start a second
  // run, so every later connection is the replay endpoint.
  let created = start.kind === "replay";
  let stopped = false;

  /** Applies one frame; `true` when it was the terminal event. */
  const applyBlock = (block: string): boolean => {
    let seq: number | null = null;
    let data = "";
    for (const line of block.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith("id:")) {
        seq = Number.parseInt(trimmed.slice(3).trim(), 10);
      } else if (trimmed.startsWith("data:")) {
        data += trimmed.slice(5).trim();
      }
    }
    if (seq === null || Number.isNaN(seq) || seq <= lastSeq || data === "") {
      return false;
    }
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return false;
    }
    const parsed = runEventSchema.safeParse(event);
    if (!parsed.success) return false;
    lastSeq = seq;
    if (parsed.data.type === "run.started" && start.kind === "create") {
      runId = parsed.data.runId;
    }
    handlers.onEvent(parsed.data, seq);
    return TERMINAL_EVENTS.has(parsed.data.type);
  };

  /** Reads the body; `true` when a terminal event closed the stream. */
  const consume = async (response: Response): Promise<boolean> => {
    const body = response.body;
    if (body === null) return false;
    const reader = body.getReader();
    activeReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const index = buffer.search(/\r?\n\r?\n/);
          if (index === -1) break;
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
          if (applyBlock(block)) return true;
        }
      }
    } finally {
      // Leaving early (terminal or abort) must not keep the socket half-open.
      void reader.cancel().catch(() => undefined);
      activeReader = null;
    }
    return false;
  };

  const open = (usePost: boolean): Promise<Response> => {
    if (usePost && start.kind === "create") {
      return fetch("/api/runs", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(start.body),
        signal: internal.signal,
      });
    }
    // S6: the reconnect carries the last applied frame, so the store
    // continues exactly where the previous stream stopped.
    const headers = new Headers({ accept: "text/event-stream" });
    if (lastSeq > 0) headers.set("last-event-id", String(lastSeq));
    const id = encodeURIComponent(runId ?? "");
    return fetch(`/api/runs/${id}/events`, {
      method: "GET",
      credentials: "include",
      headers,
      signal: internal.signal,
    });
  };

  void (async () => {
    try {
      for (;;) {
        if (stopped || internal.signal.aborted) break;
        // A dead writer must not pin the screen forever: the reader gives up
        // once the interactive budget of S10 is gone.
        if (Date.now() > deadline) {
          handlers.onEnd({ kind: "failed", message: null });
          return;
        }
        const usePost = start.kind === "create" && !created;
        created = true;
        let terminal = false;
        try {
          const response = await open(usePost);
          if (!response.ok) {
            const message = await failureMessage(response);
            // Retrying cannot fix a rejected create or a missing run.
            if (usePost || response.status === 404) {
              handlers.onEnd({ kind: "failed", message });
              return;
            }
            await sleep(reconnectMs, internal.signal);
            continue;
          }
          terminal = await consume(response);
        } catch {
          if (stopped || internal.signal.aborted) break;
          if (usePost) {
            // The create call died before the run was confirmed; there is no
            // id to reconnect to, and retrying would start a second run.
            handlers.onEnd({ kind: "failed", message: null });
            return;
          }
          await sleep(reconnectMs, signal);
          continue;
        }
        if (terminal) {
          handlers.onEnd({ kind: "terminal" });
          return;
        }
        // The stream closed without a terminal event: the connection or the
        // server dropped (S6), so wait a beat and reconnect.
        await sleep(reconnectMs, internal.signal);
      }
      handlers.onEnd({ kind: "aborted" });
    } catch {
      handlers.onEnd(
        stopped || internal.signal.aborted
          ? { kind: "aborted" }
          : { kind: "failed", message: null },
      );
    }
  })();

  return {
    abort: () => {
      stopped = true;
      internal.abort();
      // A test-constructed body ignores the signal; cancel unblocks read().
      void activeReader?.cancel().catch(() => undefined);
    },
  };
}
