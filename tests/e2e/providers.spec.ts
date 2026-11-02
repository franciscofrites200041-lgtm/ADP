import { expect, test, type BrowserContext } from "@playwright/test";

import { createSession, type SessionFixture } from "./support/session-fixture.ts";

/**
 * The Providers screen (WP-10) against the real API.
 *
 * Needs, before running: the API on `API_INTERNAL_URL` (default
 * http://localhost:3001) with the disposable PostgreSQL, and
 * `DATABASE_URL_TEST=postgres://mw_test@127.0.0.1:55432/middleware_test`.
 * Without that variable the spec skips instead of silently passing.
 */
const databaseUrl = process.env.DATABASE_URL_TEST;

test.skip(
  !databaseUrl,
  "needs DATABASE_URL_TEST and a running API (see the header comment)",
);

let session: SessionFixture;

test.beforeEach(async ({ context }) => {
  session = await createSession();
  // The web origin is what the browser sends as Origin; the session cookie is
  // valid for the whole domain the API and the web share.
  await context.addCookies([
    { ...session.cookie, domain: "localhost", path: "/" },
  ]);
});

test.afterEach(async () => {
  await session?.dispose();
});

const KEY = "sk-e2e-1234567890";

async function openProviders(page: import("@playwright/test").Page) {
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Proveedores", level: 1 })).toBeVisible();
}

async function fillCredential(
  page: import("@playwright/test").Page,
  alias: string,
  apiKey: string,
) {
  await page.getByLabel("Alias").fill(alias);
  await page.getByLabel("API key").fill(apiKey);
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
}

test("shows the form and the empty state", async ({ page }) => {
  await openProviders(page);
  await expect(page.getByRole("heading", { name: "Conectar un proveedor" })).toBeVisible();
  await expect(page.getByText("Todavía no tenés proveedores")).toBeVisible();
});

test("rejects a short key without creating anything", async ({ page }) => {
  await openProviders(page);
  await fillCredential(page, "Corta", "sk-1");
  await expect(page.getByText("Revisá los datos marcados.")).toBeVisible();
  await expect(page.getByText("Todavía no tenés proveedores")).toBeVisible();
});

test("creates a credential showing only its last four characters", async ({ page }) => {
  await openProviders(page);
  await fillCredential(page, "Personal", KEY);

  await expect(page.getByText("Personal")).toBeVisible();
  await expect(page.getByText("····7890")).toBeVisible();
  await expect(page.getByText("Sin probar")).toBeVisible();
  // S2: the key itself never reaches the page.
  await expect(page.locator("body")).not.toContainText(KEY);
  await expect(page.getByRole("button", { name: /copiar/i })).toHaveCount(0);
});

test("renames a credential", async ({ page }) => {
  await openProviders(page);
  await fillCredential(page, "Viejo", KEY);
  await expect(page.getByText("Viejo")).toBeVisible();

  await page.getByRole("button", { name: "Renombrar" }).click();
  await page.getByLabel("Renombrar").fill("Nuevo");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText("Nuevo")).toBeVisible();
  await expect(page.getByText("Viejo")).toHaveCount(0);
});

test("archives a credential after confirming", async ({ page }) => {
  await openProviders(page);
  await fillCredential(page, "Para archivar", KEY);
  await expect(page.getByText("Para archivar")).toBeVisible();

  await page.getByRole("button", { name: "Archivar" }).click();
  await expect(page.getByRole("button", { name: "Mejor no" })).toBeVisible();
  await page.getByRole("button", { name: "¿Archivar?" }).click();

  await expect(page.getByText("Todavía no tenés proveedores")).toBeVisible();
  await expect(page.getByText("Para archivar")).toHaveCount(0);
});

test("shows the base URL field only for openai-compatible", async ({ page }) => {
  await openProviders(page);
  await expect(page.getByLabel("URL del endpoint")).toHaveCount(0);
  // The pill styles the input as visually hidden; click the control directly.
  await page
    .getByRole("radio", { name: "Compatible con OpenAI" })
    .check({ force: true });
  await expect(page.getByLabel("URL del endpoint")).toBeVisible();
});

// Keeps TypeScript honest about the helper's shape even if the spec grows.
export type { BrowserContext };
