import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { getRenderCounts, assertWithinBaseline } from "./helpers/render-counts";

const baselines = JSON.parse(
  readFileSync("e2e/browser/fixtures/render-baselines.json", "utf8"),
);

test.describe("render counts — cold startup (AC1 / #298)", () => {
  test("cold startup App renders ≤ baseline", async ({ page }) => {
    await page.goto("/");

    // Welcome view is the cold-start settled signal — it's only rendered
    // when no folder/file is open, which is the default mock state.
    await expect(page.locator(".welcome-view")).toBeVisible({ timeout: 5000 });

    // Allow any post-mount async commits (theme apply, onboarding bootstrap,
    // launch-args query) to flush before we sample.
    await page.waitForTimeout(150);

    const counts = await getRenderCounts(page);
    // eslint-disable-next-line no-console
    console.log("[cold-startup counts]", JSON.stringify(counts));
    assertWithinBaseline(counts, baselines.coldStartup, "coldStartup");
  });
});
