import { useEffect } from "react";
import { listenEvent } from "@/lib/tauri-events";
import { useStore } from "@/store";
import { canonicalizeOrFallback } from "@/store/canonicalize";
import { debug } from "@/logger";

/**
 * Listens for `open-file-tab` events from the Rust backend and opens each
 * file path as a tab. The backend emits this when a file is routed to an
 * existing folder window (AddToWindow) or a file-only window is created
 * with initial files (CreateFileOnly).
 *
 * Rule `multiwin-canonicalize-at-ingest` (issue #315 Section C4): the two
 * renderer-side intake paths into the store (`openFilesFromArgs` and
 * `useOpenFileTab`) MUST canonicalise symmetrically. Without this hook
 * canonicalising, an intake-via-CLI path stored as `RUNNER~1\…` (Windows
 * 8.3 short name) would mismatch an intake-via-event path stored as the
 * long form, producing duplicate tabs and breaking ghost-entry matching.
 */
export function useOpenFileTab() {
  useEffect(() => {
    const unlisten = listenEvent("open-file-tab", (paths) => {
      void debug(`[useOpenFileTab] received ${paths.length} file(s)`); // fire-and-forget log
      // Wrap async canonicalize work in a void IIFE so the listener
      // signature stays sync (Tauri's listen() expects a void-returning
      // handler — see @typescript-eslint/no-misused-promises).
      void (async () => {
        const { openFile } = useStore.getState();
        for (const filePath of paths) {
          const canonical = await canonicalizeOrFallback(filePath);
          openFile(canonical);
        }
      })();
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
