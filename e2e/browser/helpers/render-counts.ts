import type { Page } from "@playwright/test";

/**
 * Helpers for the render-count baseline specs (issue #298 AC1-3).
 *
 * The instrumentation lives in `src/hooks/dev/useRenderCount.ts` and
 * exposes per-id counts on `window.__RENDER_COUNTS__`. Vite replaces
 * `import.meta.env.DEV` with `true` in the dev server that powers the
 * Playwright browser harness, so the side effect is live for these
 * specs. Values are StrictMode-doubled (StrictMode is enabled in
 * `src/main.tsx`).
 */
export type RenderCounts = Record<string, number>;

export async function getRenderCounts(page: Page): Promise<RenderCounts> {
  return await page.evaluate(() => {
    const w = window as unknown as { __RENDER_COUNTS__?: RenderCounts };
    return w.__RENDER_COUNTS__ ?? {};
  });
}

export async function resetRenderCounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __RENDER_COUNTS__?: Record<string, number> };
    if (w.__RENDER_COUNTS__) {
      for (const k of Object.keys(w.__RENDER_COUNTS__)) {
        delete w.__RENDER_COUNTS__[k];
      }
    }
  });
}

/**
 * Assert that every observed render count is within budget AND that the
 * set of instrumented sites observed is exactly the set baselined.
 *
 * - Drift in keys (a new `useRenderCount(...)` site, or one removed without
 *   updating the baseline) throws so the baseline file stays in sync with
 *   the codebase.
 * - Loosening a numeric budget is a regression — bumps require an explicit
 *   commit-body justification per the baseline file's `_doc` field.
 */
export function assertWithinBaseline(
  actual: RenderCounts,
  baseline: Record<string, number>,
  flow: string,
): void {
  const actualKeys = Object.keys(actual).sort();
  const baselineKeys = Object.keys(baseline).sort();

  if (JSON.stringify(actualKeys) !== JSON.stringify(baselineKeys)) {
    throw new Error(
      `[${flow}] instrumentation drift — baseline keys ${JSON.stringify(
        baselineKeys,
      )} do not match observed keys ${JSON.stringify(
        actualKeys,
      )}. Update e2e/browser/fixtures/render-baselines.json.`,
    );
  }

  for (const [id, max] of Object.entries(baseline)) {
    const observed = actual[id] ?? 0;
    if (observed > max) {
      throw new Error(
        `[${flow}] ${id} rendered ${observed} times, baseline allows ${max}. ` +
          `See e2e/browser/fixtures/render-baselines.json for context.`,
      );
    }
  }
}
