import { expect, test } from "@playwright/test";

// Without a session the API answers 401 and the (app) layout sends the browser
// to /login (§11). No database needed: the API decides.
test("unauthenticated visits to the app land on /login", async ({ page }) => {
  for (const path of ["/", "/agents", "/providers"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
});

test("the login page is reachable without a session", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("form")).toBeVisible();
});
