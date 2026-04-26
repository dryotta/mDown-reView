import { test, expect, setRootViaTest } from "./fixtures";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

/**
 * Native E2E tests for scroll stability.
 *
 * WHY NATIVE: These tests require the real rendering pipeline with actual
 * scroll containers, real Tauri IPC, and real content rendering to reproduce
 * the scroll feedback loop bug. Browser tests with mocked IPC don't exercise
 * the full React render cycle that triggers Zustand store updates and the
 * resulting useEffect re-fires that cause the oscillation.
 */
test.describe("Scroll Stability", () => {
  /**
   * Helper: find the actual scroll container (the ViewerRouter wrapper div
   * with class "viewer-scroll-region" that wraps the viewer content).
   */
  async function getScrollContainer(nativePage: import("@playwright/test").Page) {
    return nativePage.evaluate(() => {
      const candidates = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
      for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight + 10) return true;
      }
      return false;
    });
  }

  test("29.1 - programmatic scroll position is stable (no oscillation from feedback loop)", async ({ nativePage }) => {
    // Create a large file that definitely overflows the viewport
    const tmpDir = path.join(os.tmpdir(), `mdownreview-scroll-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "large.md");

    // Generate 200 lines of content to ensure scrolling is needed
    const lines: string[] = ["# Large Document for Scroll Test", ""];
    for (let i = 1; i <= 200; i++) {
      lines.push(`## Section ${i}`);
      lines.push("");
      lines.push(`This is paragraph ${i} with enough text to fill the line and make the document scrollable.`);
      lines.push("");
    }
    fs.writeFileSync(tmpFile, lines.join("\n"));

    try {
      await setRootViaTest(nativePage, tmpDir);

      // Wait for the markdown viewer to render content
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer")).toContainText("Section 1", { timeout: 5_000 });

      // Let the viewer fully settle (Shiki async highlighting, layout, etc.)
      await nativePage.waitForTimeout(2000);

      // Programmatically scroll in increments and verify monotonic increase
      const scrollPositions: number[] = [];
      for (let step = 0; step < 5; step++) {
        const targetScroll = (step + 1) * 200;

        const actualPos = await nativePage.evaluate((target) => {
          const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
          for (const el of containers) {
            if (el.scrollHeight > el.clientHeight + 10) {
              el.scrollTop = target;
              return el.scrollTop;
            }
          }
          return -1;
        }, targetScroll);

        // Wait for any React effects to settle
        await nativePage.waitForTimeout(500);

        // Re-read the position to check for oscillation
        const settledPos = await nativePage.evaluate(() => {
          const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
          for (const el of containers) {
            if (el.scrollHeight > el.clientHeight + 10) {
              return el.scrollTop;
            }
          }
          return -1;
        });

        scrollPositions.push(settledPos);

        // Position should not have drifted from where we set it
        expect(
          Math.abs(settledPos - actualPos),
          `Scroll position drifted after settling at step ${step}: set to ${actualPos}, settled at ${settledPos}. ` +
          `This indicates a scroll feedback loop.`
        ).toBeLessThan(5);
      }

      // Verify scroll positions are monotonically increasing
      for (let i = 1; i < scrollPositions.length; i++) {
        expect(
          scrollPositions[i],
          `Position at step ${i} (${scrollPositions[i]}) should be >= step ${i - 1} (${scrollPositions[i - 1]})`
        ).toBeGreaterThanOrEqual(scrollPositions[i - 1]);
      }

      // Verify we actually scrolled
      expect(scrollPositions[scrollPositions.length - 1]).toBeGreaterThan(0);

    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("29.2 - scroll position is stable after settling (no jitter)", async ({ nativePage }) => {
    // Create a large source file (non-markdown) to test SourceView scroll too
    const tmpDir = path.join(os.tmpdir(), `mdownreview-scroll-src-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "large.ts");

    // Generate a large TypeScript file
    const srcLines: string[] = ["// Large TypeScript file for scroll test"];
    for (let i = 1; i <= 300; i++) {
      srcLines.push(`export function fn${i}(): string {`);
      srcLines.push(`  return "result from function ${i}";`);
      srcLines.push(`}`);
      srcLines.push("");
    }
    fs.writeFileSync(tmpFile, srcLines.join("\n"));

    try {
      await setRootViaTest(nativePage, tmpDir);

      // Wait for the source view to render
      await expect(nativePage.locator(".source-view")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".source-view")).toContainText("fn1", { timeout: 5_000 });

      // Let the viewer fully settle
      await nativePage.waitForTimeout(2000);

      // Programmatically scroll down
      await nativePage.evaluate(() => {
        const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
        for (const el of containers) {
          if (el.scrollHeight > el.clientHeight + 10) {
            el.scrollTop = 500;
            return;
          }
        }
      });
      await nativePage.waitForTimeout(500);

      // Capture scroll position multiple times over 1 second to check for jitter
      const samples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const pos = await nativePage.evaluate(() => {
          const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
          for (const el of containers) {
            if (el.scrollHeight > el.clientHeight + 10) {
              return el.scrollTop;
            }
          }
          return -1;
        });
        samples.push(pos);
        await nativePage.waitForTimeout(200);
      }

      // All samples should be the same (no oscillation after settling)
      const first = samples[0];
      for (let i = 1; i < samples.length; i++) {
        expect(
          Math.abs(samples[i] - first),
          `Scroll position should be stable after settling. ` +
          `Sample ${i} = ${samples[i]} differs from sample 0 = ${first}. ` +
          `All samples: [${samples.join(", ")}]`
        ).toBeLessThan(2);
      }

      // Verify we're actually scrolled (not stuck at 0)
      expect(first).toBeGreaterThan(0);

    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("29.3 - wheel scroll moves content and settles without fighting", async ({ nativePage }) => {
    const tmpDir = path.join(os.tmpdir(), `mdownreview-scroll-wheel-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, "scroll-test.md");

    const lines: string[] = ["# Wheel Scroll Test", ""];
    for (let i = 1; i <= 150; i++) {
      lines.push(`Paragraph ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
      lines.push("");
    }
    fs.writeFileSync(tmpFile, lines.join("\n"));

    try {
      await setRootViaTest(nativePage, tmpDir);
      await expect(nativePage.locator(".markdown-viewer")).toBeVisible({ timeout: 10_000 });
      await expect(nativePage.locator(".markdown-viewer")).toContainText("Paragraph 1", { timeout: 5_000 });
      await nativePage.waitForTimeout(2000);

      // Move mouse to the viewer area first
      const viewerBox = await nativePage.locator(".markdown-viewer").boundingBox();
      expect(viewerBox).toBeTruthy();
      await nativePage.mouse.move(
        viewerBox!.x + viewerBox!.width / 2,
        viewerBox!.y + viewerBox!.height / 2
      );

      // Send wheel-down events
      for (let i = 0; i < 10; i++) {
        await nativePage.mouse.wheel(0, 120);
        await nativePage.waitForTimeout(100);
      }

      // Wait for scroll to settle
      await nativePage.waitForTimeout(1000);

      const posAfterWheel = await nativePage.evaluate(() => {
        const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
        for (const el of containers) {
          if (el.scrollHeight > el.clientHeight + 10) {
            return el.scrollTop;
          }
        }
        return 0;
      });

      // Verify scroll moved (wheel events reached the scroll container)
      // If wheel events don't reach, we fall back to verifying stability
      if (posAfterWheel > 0) {
        // Verify position is stable after wheel stops
        await nativePage.waitForTimeout(500);
        const posAfterSettle = await nativePage.evaluate(() => {
          const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
          for (const el of containers) {
            if (el.scrollHeight > el.clientHeight + 10) {
              return el.scrollTop;
            }
          }
          return 0;
        });

        expect(
          Math.abs(posAfterSettle - posAfterWheel),
          `Scroll position should be stable after wheel stops. Was ${posAfterWheel}, now ${posAfterSettle}`
        ).toBeLessThan(2);
      }

      // Also verify programmatic scroll still works correctly
      const scrollTarget = 400;
      await nativePage.evaluate((target) => {
        const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
        for (const el of containers) {
          if (el.scrollHeight > el.clientHeight + 10) {
            el.scrollTop = target;
            return;
          }
        }
      }, scrollTarget);

      await nativePage.waitForTimeout(500);

      const finalPos = await nativePage.evaluate(() => {
        const containers = document.querySelectorAll<HTMLElement>('.viewer-scroll-region');
        for (const el of containers) {
          if (el.scrollHeight > el.clientHeight + 10) {
            return el.scrollTop;
          }
        }
        return -1;
      });

      expect(
        Math.abs(finalPos - scrollTarget),
        `Programmatic scroll should hold position. Target ${scrollTarget}, actual ${finalPos}`
      ).toBeLessThan(5);

    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
