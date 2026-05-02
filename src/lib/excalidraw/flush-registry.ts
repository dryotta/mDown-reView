/**
 * Issue #352 / iter-12 — Excalidraw close-flush registry.
 *
 * Active `<ExcalidrawView>` instances register a flush callback while
 * mounted in editor mode. The close-flush hook drains every registered
 * flush before acking the Rust close-handshake (see
 * `src-tauri/src/commands/excalidraw_close.rs`). Without this registry
 * the WebView2 / WKWebView host process tears down before any React
 * `useEffect` cleanup runs, so the per-instance `flushAutoSave` never
 * fires on app close — losing up to one debounce window of edits.
 *
 * Registry keys are file paths (one editor per path; tab-key == path).
 * Re-registering for the same path replaces the previous callback —
 * idempotent on remount.
 *
 * Module-scope singleton mirroring the pattern of `MD_COMPONENTS` in
 * `MarkdownComponentsMap` (frozen-once-stable identity at module load,
 * no hooks, no React).
 */

type FlushFn = () => Promise<void>;

const registry = new Map<string, FlushFn>();

/**
 * Register a flush callback for an active editor. Returns an unregister
 * function — caller MUST invoke it on unmount, otherwise the callback
 * captures a stale closure over a torn-down React tree.
 */
export function registerExcalidrawFlush(
  filePath: string,
  flush: FlushFn,
): () => void {
  registry.set(filePath, flush);
  return () => {
    // Only unregister if WE are the current owner. Defensive: if a
    // remount registered a fresh flush before we got around to cleaning
    // up the old one, don't yank the new one.
    if (registry.get(filePath) === flush) {
      registry.delete(filePath);
    }
  };
}

/**
 * Drain every registered flush in parallel. Resolves when all complete
 * (or reject — failures are logged-and-swallowed so a single failure
 * doesn't block the close handshake).
 *
 * Resolves immediately (next-microtask) when the registry is empty,
 * which is the steady-state for users who never opened an Excalidraw
 * editor — keeping the close-handshake latency negligible.
 */
export async function flushAllPendingExcalidrawSaves(): Promise<void> {
  const flushes = Array.from(registry.values());
  if (flushes.length === 0) return;
  await Promise.all(
    flushes.map((flush) =>
      flush().catch((err: unknown) => {
        // Don't reject the close handshake on a single editor failure.
        // The user is closing the app — best-effort drain is the right
        // contract.
        // eslint-disable-next-line no-console
        console.warn("[excalidraw-flush] flush failed:", err);
      }),
    ),
  );
}

/**
 * Test-only: clear the registry. Vitest tests reuse the module across
 * cases; without this, registrations leak between tests.
 */
export function __TEST_ONLY_clearRegistry(): void {
  registry.clear();
}

/** Test-only: count of currently-registered flushes. */
export function __TEST_ONLY_size(): number {
  return registry.size;
}
