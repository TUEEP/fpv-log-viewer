import { expect, test } from "@playwright/test";

test("renders viewer shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/FPV/i)).toBeVisible();
});
