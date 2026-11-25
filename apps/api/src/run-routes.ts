import {
  createRunRequestSchema,
  type RunEvent,
  type RunResponse,
  runStatusSchema,
} from "@middleware/contracts";
import type {
  LiveEventBus,
  Run,
  RunEventStore,
  RunRepo,
  RunService,
} from "@middleware/core";
import { NotFoundError } from "@middleware/core";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runFailureMessage } from "./messages.ts";
import { requireOrigin } from "./origin.ts";
import {
  requireWorkspace,
  type SessionReader,
  type WorkspaceEnv,
} from "./workspace.ts";

const runIdParamSchema = z.strictObject({ id: z.uuid() });

const runListQuerySchema = z.strictObject({
  status: runStatusSchema.optional(),
  agentId: z.uuid().optional(),
});

/** `Last-Event-ID` (or its query fallback) must be a whole sequence number. */
const seqSchema = z.coerce.number().int().min(0);

const LIST_LIMIT = 100;

/** Every poll waits this long before re-reading the store (S6). */
const STREAM_POLL_MS = 500;

const TERMINAL_EVENTS: ReadonlySet<RunEvent["type"]> = new Set([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

const toRunResponse = (run: Run): RunResponse => ({
  id: run.id,
  agentId: run.agentId,
  agentVersionId: run.agentVersionId,
  conversationId: run.conversationId,
  status: run.status,
  input: run.input,
  output: run.output,
  errorCode: run.errorCode,
  errorMessage: run.errorMessage,
  queuedAt: run.queuedAt.toISOString(),
  startedAt: run.startedAt?.toISOString() ?? null,
  finishedAt: run.finishedAt?.toISOString() ?? null,
});

/** Everything the streaming loop reads; the wires come from the container. */
export type RunRoutesDeps = {
  service: RunService;
  runRepo: RunRepo;
  eventStore: RunEventStore;
  /** Live fan-out of this process (S4); the store is still the truth. */
  liveBus: LiveEventBus;
};

type StreamSource = {
  workspaceId: string;
  runId: string;
  eventStore: RunEventStore;
  runRepo: RunRepo;
  /** `null` for the reconnect path, which polls the store only (S6). */
  liveBus: LiveEventBus | null;
  pollMs: number;
};

/**
 * The store keeps the engine's code-only event (WP-33); the copy is API-side.
 * The raw code and the provider's text never reach the client (S2, §8).
 */
const toClientEvent = (event: RunEvent): RunEvent =>
  event.type === "run.failed"
    ? { ...event, message: runFailureMessage(event.code) }
    : event;

/**
 * One SSE stream of a run, starting at `fromSeq`. The store is the source of
 * truth: every drain reads it in order, so frames are gap-free even when a
 * live-bus message is missed; the bus only makes the same frames arrive
 * sooner (S4). The terminal event (§10) closes the stream; a client that
 * stops reading is detected by its failed write, and the run itself — which
 * lives in `BackgroundTasks` — keeps going (S2).
 */
function streamRunEvents(
  c: Context<WorkspaceEnv>,
  source: StreamSource,
  fromSeq: number,
): Response {
  return streamSSE(c, async (stream) => {
    let lastSeq = fromSeq;
    let done = false;
    let broken = false;
    let draining = false;
    let terminalTicks = 0;
    let wake: (() => void) | undefined;

    const writeFrame = async (seq: number, event: RunEvent) => {
      try {
        await stream.writeSSE({
          id: String(seq),
          event: event.type,
          data: JSON.stringify(event),
        });
      } catch {
        // The client left: stop writing, never stop the run (S2, D15).
        broken = true;
      }
    };

    /** Writes everything stored after `lastSeq`; `true` when it wrote. */
    const writeStored = async (): Promise<boolean> => {
      const rows = await source.eventStore.listAfter(
        source.workspaceId,
        source.runId,
        lastSeq,
      );
      for (const row of rows) {
        if (row.seq <= lastSeq) continue;
        await writeFrame(row.seq, toClientEvent(row.event));
        lastSeq = row.seq;
        if (TERMINAL_EVENTS.has(row.event.type)) done = true;
      }
      return rows.length > 0;
    };

    const drain = async (): Promise<void> => {
      if (draining || done || broken) return;
      draining = true;
      try {
        while (!done && !broken) {
          const wrote = await writeStored();
          if (done || broken) break;
          if (wrote) {
            terminalTicks = 0;
            continue;
          }
          // A terminal row ends the stream even without its terminal event
          // (a broken executor), so no client can hang forever (§10). The
          // event is stored before the row closes (S7), so one more read
          // here can never skip it. The grace of two consecutive empty
          // polls covers the one live exception: a canceller marks a claimed
          // run terminal and its executor writes `run.cancelled` at the next
          // turn boundary (S11) — milliseconds away. A dead writer writes
          // nothing, ever, so the stream ends instead of polling forever,
          // and it ends without inventing an event the contract does not
          // allow (§10).
          const run = await source.runRepo.findById(
            source.workspaceId,
            source.runId,
          );
          if (run !== null && TERMINAL_STATUSES.has(run.status)) {
            const caught = await writeStored();
            if (!caught) {
              terminalTicks += 1;
              if (terminalTicks >= 2) done = true;
            } else {
              terminalTicks = 0;
            }
          } else {
            terminalTicks = 0;
          }
          break;
        }
      } catch {
        // A failed read retries on the next tick; the stream only ends at
        // the terminal event or when the client is gone (S6).
      } finally {
        draining = false;
        if (done || broken) wake?.();
      }
    };

    const unsubscribe =
      source.liveBus?.subscribe(source.runId, (message) => {
        if (message.seq > lastSeq) void drain();
      }) ?? (() => {});
    const timer = setInterval(() => void drain(), source.pollMs);
    const settled = new Promise<void>((resolve) => {
      wake = resolve;
    });

    try {
      // First drain: everything already stored, including events the run
      // emitted before this stream subscribed (D15, S6).
      await drain();
      await settled;
    } finally {
      clearInterval(timer);
      unsubscribe();
    }
  });
}

// Malformed JSON becomes `undefined`, rejected as invalid_request.
const readJson = (c: Context): Promise<unknown> =>
  c.req.json().catch(() => undefined);

/** Thin handlers: parse, call the port, map the domain row to the contract. */
function runHandlers(runs: RunRoutesDeps) {
  return {
    start: async (c: Context<WorkspaceEnv>) => {
      const input = createRunRequestSchema.parse(await readJson(c));
      const started = await runs.service.startRun(
        c.get("workspaceId"),
        c.get("userId"),
        input,
      );
      // `background: true` is the detached form of §10: the caller gets the
      // id and the run still executes in `BackgroundTasks` (S2, WP-50).
      if (input.background === true) {
        return c.json({ runId: started.runId }, 202);
      }
      // D15: one request creates the run and answers with the SSE stream of
      // that very run — there is no id-then-subscribe round trip.
      return streamRunEvents(
        c,
        {
          workspaceId: c.get("workspaceId"),
          runId: started.runId,
          eventStore: runs.eventStore,
          runRepo: runs.runRepo,
          liveBus: runs.liveBus,
          pollMs: STREAM_POLL_MS,
        },
        0,
      );
    },

    events: async (c: Context<WorkspaceEnv>) => {
      const { id } = runIdParamSchema.parse(c.req.param());
      const workspaceId = c.get("workspaceId");
      const run = await runs.runRepo.findById(workspaceId, id);
      if (run === null) throw new NotFoundError();
      // Header first, query as the fallback (S6); absent means full replay.
      const lastEventId =
        c.req.header("last-event-id") ?? c.req.query("lastEventId");
      const fromSeq =
        lastEventId === undefined || lastEventId === ""
          ? 0
          : seqSchema.parse(lastEventId);
      return streamRunEvents(
        c,
        {
          workspaceId,
          runId: id,
          eventStore: runs.eventStore,
          runRepo: runs.runRepo,
          liveBus: null,
          pollMs: STREAM_POLL_MS,
        },
        fromSeq,
      );
    },

    cancel: async (c: Context<WorkspaceEnv>) => {
      const { id } = runIdParamSchema.parse(c.req.param());
      const workspaceId = c.get("workspaceId");
      const run = await runs.runRepo.findById(workspaceId, id);
      if (run === null) throw new NotFoundError();
      if (TERMINAL_STATUSES.has(run.status)) {
        // Cancelling a finished run is a no-op that reports its state.
        return c.json(toRunResponse(run));
      }
      const cancelled = await runs.runRepo.finish(workspaceId, id, {
        status: "cancelled",
        output: null,
      });
      if (run.status === "queued") {
        // No executor ever claims a terminal run, so this path is the only
        // chance for the §10 terminal event; a claimed run gets its
        // `run.cancelled` from the executor's next turn boundary (S11).
        await runs.eventStore.append(workspaceId, id, [
          { type: "run.cancelled" },
        ]);
      }
      return c.json(toRunResponse(cancelled ?? run));
    },

    list: async (c: Context<WorkspaceEnv>) => {
      const query = runListQuerySchema.parse(c.req.query());
      const found = await runs.runRepo.listByWorkspace(c.get("workspaceId"), {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        limit: LIST_LIMIT,
      });
      return c.json({ runs: found.map(toRunResponse) });
    },
  } satisfies Record<string, (c: Context<WorkspaceEnv>) => Promise<Response>>;
}

/**
 * The run surface of §10: start with its stream (D15), reconnect (S6),
 * cancel and list. All behind the session; writes check the origin (S10).
 * Errors go to the app's `onError`.
 */
export function runRoutes(
  auth: SessionReader,
  runs: RunRoutesDeps,
  allowedOrigins: readonly string[],
): Hono<WorkspaceEnv> {
  const app = new Hono<WorkspaceEnv>();
  const session = requireWorkspace(auth);
  // S10: writes check the origin; reads do not.
  const write = requireOrigin(allowedOrigins);
  const handle = runHandlers(runs);

  app.post("/api/runs", session, write, handle.start);
  app.get("/api/runs", session, handle.list);
  app.get("/api/runs/:id/events", session, handle.events);
  app.post("/api/runs/:id/cancel", session, write, handle.cancel);

  return app;
}
