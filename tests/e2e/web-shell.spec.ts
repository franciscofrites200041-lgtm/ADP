import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("navigates through the authenticated shell on desktop and mobile", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Agentes" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("heading", { name: "Agentes", exact: true })).toBeVisible();

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
