/**
 * Mermaid singleton with serialized render queue.
 *
 * Resolves the documented multi-instance race in `MermaidView.tsx` where
 * `mermaid.initialize()` is called per-mount: two `<MermaidView>` instances
 * mounting concurrently with different themes could interleave
 * `initialize`/`render` such that one diagram rendered with the other
 * instance's theme. We collapse all calls onto a single queue so at most
 * one `mermaid.render()` is in flight, and `initialize()` is re-applied
 * only when the requested theme differs from the cached one.
 *
 * Mirrors the Shiki singleton pattern (`src/lib/shiki.ts`,
 * `docs/design-patterns.md`) and rule 4 of `docs/performance.md` (shared
 * singletons for heavyweight init). The dynamic `import("mermaid")` is
 * preserved so Mermaid stays out of the main bundle (rule 28 of
 * `docs/performance.md`). Security posture (`securityLevel: "strict"`)
 * mirrors `docs/security.md`.
 */

export type MermaidTheme = "default" | "dark";

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
let currentTheme: MermaidTheme | null = null;
let chain: Promise<unknown> = Promise.resolve();

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

/**
 * Serialized render chokepoint. Across the app at most one
 * `mermaid.render()` is in flight; theme `initialize()` is re-applied
 * only when the requested theme differs from the cached one. Mirrors
 * Shiki singleton pattern (see docs/design-patterns.md). Resolves the
 * race where two MermaidCanvas instances mount with different themes.
 *
 * Errors are propagated — callers preserve their existing error UI
 * (mirrors the try/catch in `MermaidView.tsx`).
 */
export async function renderMermaid(opts: {
  theme: MermaidTheme;
  id: string;
  content: string;
}): Promise<{ svg: string }> {
  const job = chain.then(async () => {
    const mermaid = await loadMermaid();
    if (currentTheme !== opts.theme) {
      mermaid.initialize({
        startOnLoad: false,
        theme: opts.theme,
        securityLevel: "strict",
      });
      currentTheme = opts.theme;
    }
    const { svg } = await mermaid.render(opts.id, opts.content);
    return { svg };
  });
  // Keep the chain alive across rejections so a single failed render does
  // not poison subsequent calls. Each caller still sees the original error
  // via `job` itself.
  chain = job.catch(() => undefined);
  return job;
}

/**
 * test-only — do not call from production code.
 */
export function __resetForTests(): void {
  mermaidPromise = null;
  currentTheme = null;
  chain = Promise.resolve();
}
