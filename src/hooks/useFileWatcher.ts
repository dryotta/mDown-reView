import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { listenEvent } from "@/lib/tauri-events";
import { useStore } from "@/store";
import { updateWatchedFiles, scanReviewFiles } from "@/lib/tauri-commands";
import { warn, debug } from "@/logger";

const SAVE_DEBOUNCE_MS = 1500;
const SCAN_DEBOUNCE_MS = 500;

/**
 * Convert a `file-changed` event path to the source-file path used as
 * the `lastSaveByPath` key. The watcher emits the sidecar path for
 * `kind=review` (e.g. `/ws/foo.md.review.yaml`), so we must strip the
 * suffix before looking up the per-source save timestamp — otherwise
 * the suppression silently no-ops because the sidecar key never matches
 * the source-keyed timestamp recorded by `recordSave`.
 *
 * Same shape as `sourcePathFromEvent` in `useFileBadges.ts:40-44`;
 * flag for shared consolidation if a third consumer materializes.
 */
function sourcePathFromEvent(p: string): string {
  if (p.endsWith(".review.yaml")) return p.slice(0, -".review.yaml".length);
  if (p.endsWith(".review.json")) return p.slice(0, -".review.json".length);
  return p;
}

export function useFileWatcher() {
  // RC2/P1.1 — subscribe to the set of tab paths only. Selecting the
  // whole `tabs` array re-fires this hook (and its `updateWatchedFiles`
  // effect) on every scroll-tick `setScrollTop`, because `setScrollTop`
  // rebuilds the tabs array via `s.tabs.map(...)`. `useShallow` returns
  // the previous array reference when the path set is element-wise
  // unchanged, so the effect only fires on add/remove/reorder.
  const tabPaths = useStore(useShallow((s) => s.tabs.map((t) => t.path)));
  const root = useStore((s) => s.root);
  const setGhostEntries = useStore((s) => s.setGhostEntries);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RC2/P1.5 (#298) — `lastSaveByPath` is read imperatively inside the
  // `file-changed` listener via `useStore.getState()` (Rule 30 Hot-tier
  // discipline in docs/architecture.md). Subscribing via selector would
  // re-render this hook whenever any save fires, with no benefit since
  // the listener body re-reads anyway.

  // Debounced scan coalesces rapid deletions into a single scanReviewFiles call
  const debouncedScan = useCallback(() => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(() => {
      const currentRoot = useStore.getState().root;
      if (currentRoot) {
        scanReviewFiles(currentRoot)
          .then((pairs) =>
            useStore
              .getState()
              .setGhostEntries(
                pairs.map(([sidecarPath, sourcePath]) => ({ sidecarPath, sourcePath }))
              )
          )
          .catch((err) => warn(`[useFileWatcher] failed to re-scan after deletion: ${err}`));
      }
    }, SCAN_DEBOUNCE_MS);
  }, []);

  // Sync open tabs to Rust watcher
  useEffect(() => {
    updateWatchedFiles(tabPaths).catch((err) =>
      warn(`[useFileWatcher] failed to update watched files: ${err}`)
    );
  }, [tabPaths]);

  // Listen for file-changed events from Rust
  useEffect(() => {
    const unlisten = listenEvent("file-changed", (payload) => {
      const { path, kind } = payload;
      const now = Date.now();
      // Normalize sidecar→source path: `lastSaveByPath` is keyed by
      // source path, but the watcher emits the sidecar path for
      // `kind=review` events. Without this strip the suppression
      // silently no-ops on every external sidecar edit.
      const sourcePath = sourcePathFromEvent(path);
      const lastSave = useStore.getState().lastSaveByPath[sourcePath] ?? 0;

      if (now - lastSave < SAVE_DEBOUNCE_MS) {
        void debug(`[useFileWatcher] ignoring event within save debounce window: ${path}`); // fire-and-forget log inside sync event handler
        return;
      }

      void debug(`[useFileWatcher] file changed: ${path} (${kind})`); // fire-and-forget log inside sync event handler
      window.dispatchEvent(
        new CustomEvent("mdownreview:file-changed", {
          detail: { path, kind },
        })
      );

      // Debounced re-scan for ghost entries on any deletion
      // (source deletion → new ghost; sidecar deletion → ghost removed)
      if (kind === "deleted") {
        debouncedScan();
      }
    });

    // Re-scan ghosts when sidecar config changes (toggle or migration)
    const unlistenConfig = listenEvent("sidecar-config-changed", () => {
      void debug("[useFileWatcher] sidecar config changed, re-scanning ghosts"); // fire-and-forget log inside sync event handler
      debouncedScan();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
      unlistenConfig.then((fn) => fn()).catch(() => {});
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [debouncedScan]);

  // Scan for ghost entries when workspace root changes.
  // A `cancelled` flag guards against stale responses after rapid root
  // switches (issue #250).
  useEffect(() => {
    if (!root) {
      setGhostEntries([]);
      return;
    }
    let cancelled = false;
    scanReviewFiles(root)
      .then((pairs) => {
        if (cancelled) return;
        setGhostEntries(pairs.map(([sidecarPath, sourcePath]) => ({ sidecarPath, sourcePath })));
      })
      .catch((err) => warn(`[useFileWatcher] failed to scan review files: ${err}`));
    return () => {
      cancelled = true;
    };
  }, [root, setGhostEntries]);
}
