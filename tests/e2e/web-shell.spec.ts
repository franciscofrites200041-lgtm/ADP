import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The shell lives behind the (app) layout, which now requires a session. Pass
// the cookie of a signed-in user to run it:
//   E2E_SESSION_COOKIE="mw.session_token=..." pnpm exec playwright test
const cookie = process.env.E2E_SESSION_COOKIE;

test.skip(!cookie, "needs E2E_SESSION_COOKIE from a signed-in user");

test.beforeEach(async ({ context }) => {
  if (!cookie) return;
  await context.addCookies(
    cookie.split(";").map((pair) => {
      const [name, ...value] = pair.trim().split("=");
      return {
        name: name ?? "",
        value: value.join("="),
        url: "http://localhost:3000",
      };
    }),
  );
});

test("navigates through the authenticated shell on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Agentes" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(
    page.getByRole("heading", { name: "Agentes", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.getByRole("link", { name: "Proveedores" }).click();
  await expect(page).toHaveURL(/\/providers$/);
  await expect(
    page.getByRole("heading", { name: "Todavía no tenés proveedores" }),
  ).toBeVisible();

  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({
    violations: [],
  });
});
