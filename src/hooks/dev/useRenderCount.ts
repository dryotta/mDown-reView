import { useRef } from "react";

/**
 * Per-id render counter for dev/test diagnostics.
 *
 * - **Dev/test only side effect.** `useRef(0)` is called unconditionally
 *   so React's rules-of-hooks holds for every build. The
 *   `import.meta.env.DEV` early-return then guards only the increment
 *   and the `window.__RENDER_COUNTS__` write — Vite replaces
 *   `import.meta.env.DEV` with a literal boolean at build time so the
 *   guarded block is dead code in production. The prod cost is one
 *   `useRef(0)` allocation per mount of an instrumented component
 *   (currently App, FolderTree, ViewerRouter — three sites total).
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
 */
export function useRenderCount(id: string): void {
  // useRef is called unconditionally so React's rules-of-hooks holds for
  // every build. The DEV gate then suppresses only the side effect.
  const ref = useRef(0);
  if (!import.meta.env.DEV) return;
  /* eslint-disable react-hooks/refs, react-hooks/immutability --
     intentional render-time mutation: a render counter without
     render-time write would not count anything. The hook is gated by
     `import.meta.env.DEV` (replaced by Vite with a literal boolean at
     build time) so this code is dead in prod. */
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
