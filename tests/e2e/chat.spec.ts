import { expect, test } from "@playwright/test";

import {
  createSession,
  type SessionFixture,
} from "./support/session-fixture.ts";

/**
 * The chat screen (T9) against the real web app.
 *
 * Needs, before running: the API on `API_INTERNAL_URL` (default
 * http://localhost:3001) with the disposable PostgreSQL, and
 * `DATABASE_URL_TEST=postgres://mw_test@127.0.0.1:55432/middleware_test` and
 * `E2E_API_DATABASE_URL` set to the same URL (see providers.spec.ts). The
 * suite runs against a production build served by `next start`; this machine
 * does not hydrate under `next dev`.
 *
 * The session is real (the (app) layout checks it server-side). The model
 * endpoints, in contrast, are scripted at the network layer: the production
 * API can only reach real providers, and CI never calls one, so the run
 * stream and its history are served by this spec. What stays real is the
 * browser path: fetch streaming, reconnection with `Last-Event-ID` (S6) and
 * the reload that rehydrates the run from the URL.
 */
const databaseUrl = process.env.DATABASE_URL_TEST;

test.skip(
  !databaseUrl,
  "needs DATABASE_URL_TEST and a running API (see the header comment)",
);

let session: SessionFixture;

test.beforeEach(async ({ context }) => {
  session = await createSession();
  await context.addCookies([
    { ...session.cookie, domain: "localhost", path: "/" },
  ]);
});

test.afterEach(async () => {
  await session?.dispose();
});

const AGENT_ID = "0190a5f2-0000-7000-8000-000000000001";
const CONVERSATION_ID = "0190a5f2-0000-7000-8000-000000000002";
const RUN_ID = "0190a5f2-0000-7000-8000-000000000003";
const VERSION_ID = "0190a5f2-0000-7000-8000-000000000000";
const MESSAGE_ID = "0190a5f2-0000-7000-8000-000000000004";
const USER_MESSAGE_ID = "0190a5f2-0000-7000-8000-000000000005";
const NOW = new Date().toISOString();

const QUESTION = "¿Cómo estás?";
/** Full answer: `message.completed` and the history endpoint agree on it. */
const ANSWER = "¡Hola! Soy tu agente. Estoy lista. ¿Y vos?";

const started = {
  type: "run.started",
  runId: RUN_ID,
  agentVersionId: VERSION_ID,
  model: "test-model",
};

const delta = (text: string) => ({
  type: "message.delta",
  messageId: MESSAGE_ID,
  text,
});

const completed = {
  type: "message.completed",
  messageId: MESSAGE_ID,
  content: ANSWER,
};

const runCompleted = {
  type: "run.completed",
  output: ANSWER,
  finishedAt: NOW,
};

const frame = (seq: number, event: { type: string }): string =>
  `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const framesText = (seqs: Array<[number, { type: string }]>): string =>
  seqs.map(([seq, event]) => frame(seq, event)).join("");

const sseHeaders = { "content-type": "text/event-stream" };

const json = (body: unknown, status = 200) => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const agent = {
  id: AGENT_ID,
  name: "Soporte",
  description: null,
  currentVersion: null,
  archivedAt: null,
};

const conversation = {
  id: CONVERSATION_ID,
  agentId: AGENT_ID,
  title: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const userMessageRow = {
  id: USER_MESSAGE_ID,
  role: "user",
  content: QUESTION,
  createdAt: NOW,
};

const assistantMessageRow = {
  id: MESSAGE_ID,
  role: "assistant",
  content: ANSWER,
  createdAt: NOW,
};

test("keeps the answer alive across a reload mid-answer", async ({ page }) => {
  test.setTimeout(30_000);

  // The run history starts with just the user message; the assistant's final
  // message exists only after the run completes (S7).
  let runCompletedServed = false;
  const history = () =>
    json({
      messages: runCompletedServed
        ? [userMessageRow, assistantMessageRow]
        : [userMessageRow],
      nextCursor: null,
    });

  // The POST stream drops after three frames (a dead connection, S6): the
  // client must reconnect with `Last-Event-ID` instead of losing the answer.
  const holdsSeen = new Map<string, number>();
  const hold = { release: null as (() => void) | null };

  await page.route("**/api/runs", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: sseHeaders,
      body: framesText([
        [1, started],
        [2, delta("¡Hola!")],
        [3, delta(" Soy tu agente")],
      ]),
    });
  });

  await page.route("**/api/runs/*/events", async (route, request) => {
    const lastEventId = request.headers()["last-event-id"] ?? "";
    // Fresh page after the reload: nothing was shown yet, so the store is
    // replayed in full (S6) and the client rebuilds the answer once.
    if (lastEventId === "") {
      runCompletedServed = true;
      await route.fulfill({
        status: 200,
        headers: sseHeaders,
        body: framesText([
          [1, started],
          [2, delta("¡Hola!")],
          [3, delta(" Soy tu agente")],
          [4, delta(". Estoy")],
          [5, delta(" lista.")],
          [6, delta(" ¿Y vos?")],
          [7, completed],
          [8, runCompleted],
        ]),
      });
      return;
    }
    // The first reconnect continues exactly where the drop happened.
    if (lastEventId === "3") {
      await route.fulfill({
        status: 200,
        headers: sseHeaders,
        body: framesText([
          [4, delta(". Estoy")],
          [5, delta(" lista.")],
        ]),
      });
      return;
    }
    // Before the reload the stream stays open without new frames: the page
    // sits mid-answer, which is the moment the test reloads it.
    const holds = (holdsSeen.get(lastEventId) ?? 0) + 1;
    holdsSeen.set(lastEventId, holds);
    if (holds === 1) {
      await new Promise<void>((resolve) => {
        hold.release = resolve;
      });
      await route.fulfill({ status: 200, headers: sseHeaders, body: "" });
      return;
    }
    await route.fulfill({ status: 200, headers: sseHeaders, body: "" });
  });

  await page.route("**/api/agents", async (route) => {
    await route.fulfill(json({ agents: [agent] }));
  });

  await page.route("**/api/conversations", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill(json(conversation, 201));
  });

  await page.route("**/api/conversations/*/messages", async (route) => {
    await route.fulfill(history());
  });

  await page.goto("/chat");
  await page
    .getByRole("combobox", { name: "Agente" })
    .selectOption({ label: "Soporte" });

  await page.getByLabel("Mensaje").fill(QUESTION);
  await page.getByRole("button", { name: "Enviar" }).click();

  // Mid-answer: part of the reply is already on screen, the rest is pending.
  await expect(page.getByText(QUESTION)).toBeVisible();
  await expect(
    page.getByText("¡Hola! Soy tu agente. Estoy lista."),
  ).toBeVisible();

  // Wait until the client is parked on the reconnect that delivers nothing:
  // from here on, everything shown is exactly what a reload must preserve.
  await expect
    .poll(() => holdsSeen.get("5") ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Reload mid-answer; the URL names the run, so the screen rehydrates it.
  await page.reload();
  hold.release?.();

  // The earlier text survives the reload...
  await expect(page.getByText(QUESTION)).toBeVisible();
  // ...and the answer still completes, rendered exactly once.
  await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(ANSWER)).toHaveCount(1);
  await expect(page.getByText(QUESTION)).toHaveCount(1);

  // The client proved it reconnects with the last applied sequence (S6).
  expect([...holdsSeen.keys()]).toContain("5");
});
