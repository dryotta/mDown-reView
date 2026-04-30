import { useRef } from "react";

/**
 * Per-id render counter for dev/test diagnostics.
 *
 * - **Dev/test only.** Tree-shaken from production bundles via the
 *   `import.meta.env.DEV` early-return guard. Vite replaces
 *   `import.meta.env.DEV` at build time with a literal boolean, so the
 *   useRef call below is dead code in production.
 * - Exposes counts via `window.__RENDER_COUNTS__` so Playwright e2e
 *   specs can read them through `page.evaluate`. Counts persist across
 *   the lifetime of the page until `resetRenderCounts()` is called.
 * - StrictMode double-invokes the render → counter increments by 2 per
 *   logical render. Tests must either disable StrictMode for the SUT
 *   or assert post-doubled values explicitly.
 *
 * Usage:
 *   function App() {
 *     useRenderCount("App");
 *     // …
 *   }
 *
 *   // In a test:
 *   const before = window.__RENDER_COUNTS__?.App ?? 0;
 *   // ...drive interaction...
 *   expect(window.__RENDER_COUNTS__?.App).toBeLessThanOrEqual(before + 1);
 *
 * The hook is intentionally a no-op in production. Calling it from
 * production components is safe and adds a single function-call cost
 * which Vite's dead-code elimination removes from minified output.
 */
export function useRenderCount(id: string): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- DEV is a build-time constant; the hook order is stable per build.
  const ref = useRef(0);
  // The whole point of this diagnostic is to count function-body invocations,
  // which requires mutating during render. The mutation is idempotent w.r.t.
  // the rendered output (we never read `ref.current` during render to derive
  // JSX) and the global write is to a dev-only diagnostic surface, not React
  // state. eslint-disable is required because the React 19 compiler rules
  // (react-hooks/refs, react-hooks/immutability) forbid both patterns by
  // default.
  /* eslint-disable react-hooks/refs, react-hooks/immutability -- dev-only diagnostic counter; intentional render-time mutation */
  ref.current += 1;
  if (typeof window !== "undefined") {
    const w = window as unknown as { __RENDER_COUNTS__?: Record<string, number> };
    if (!w.__RENDER_COUNTS__) w.__RENDER_COUNTS__ = {};
    w.__RENDER_COUNTS__[id] = ref.current;
  }
  /* eslint-enable react-hooks/refs, react-hooks/immutability */
}

/** Read the current render count for an id (test/e2e use only). */
export function getRenderCount(id: string): number {
  if (typeof window === "undefined") return 0;
  const w = window as unknown as { __RENDER_COUNTS__?: Record<string, number> };
  return w.__RENDER_COUNTS__?.[id] ?? 0;
}

/** Reset all render counts (test/e2e use only). */
export function resetRenderCounts(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __RENDER_COUNTS__?: Record<string, number> };
  if (w.__RENDER_COUNTS__) {
    for (const k of Object.keys(w.__RENDER_COUNTS__)) {
      delete w.__RENDER_COUNTS__[k];
    }
  }
}
