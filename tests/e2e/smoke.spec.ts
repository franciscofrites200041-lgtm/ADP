import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  createSession,
  type SessionFixture,
} from "./support/session-fixture.ts";

/**
 * Every screen of the shell, opened in a real browser.
 *
 * This exists because three real UI defects reached `main` while unit tests,
 * typecheck and lint were green: a React error #137 that dropped a page into
 * its error boundary, a form that passed children to an input, and a chat
 * screen that lost the answer on reload. Each was one browser visit away from
 * being obvious.
 *
 * Needs, before running: the API on http://localhost:3001 against the
 * disposable PostgreSQL, the web app on http://localhost:3000, and
 * `DATABASE_URL_TEST` plus `E2E_API_DATABASE_URL` pointing at that same
 * database (see `providers.spec.ts`). Without `DATABASE_URL_TEST` the suite
 * skips instead of passing silently.
 */
const environment = z
  .object({ DATABASE_URL_TEST: z.string().min(1).optional() })
  .parse(process.env);
const databaseUrl = environment.DATABASE_URL_TEST;

test.skip(
  !databaseUrl,
  "needs DATABASE_URL_TEST and a running API (see the header comment)",
);

/** Routes of the app shell, with the heading each one must render. */
const routes = [
  { path: "/", heading: "/tus keys" },
  { path: "/agents", heading: "Agentes" },
  { path: "/chat", heading: "Chats" },
  { path: "/providers", heading: "Proveedores" },
  { path: "/runs", heading: "Ejecuciones" },
  { path: "/usage", heading: "Uso" },
  { path: "/settings", heading: "Ajustes" },
] as const;

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

for (const route of routes) {
  test(`${route.path} renders instead of falling into the error boundary`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(route.path);

    // The error boundary renders its own copy; a green unit suite cannot see
    // it, and neither can a build.
    await expect(page.getByText("Algo salió mal")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: route.heading, level: 1 }),
    ).toBeVisible();
    expect(errors, `${route.path} logged: ${errors.join(" | ")}`).toEqual([]);
  });
}
