import { startTransition, useEffect, useState } from "react";

import { extractScene, type ExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { warn as logWarn } from "@/logger";

/**
 * Issue #352 / iter-12 — Excalidraw scene-load hook.
 *
 * Bridges the file-content prop into the canvas's `initialData`:
 *   - **Canonical `.excalidraw` / `.excalidrawlib`**: `content` is JSON
 *     text; we parse it directly. `.excalidrawlib` files have a
 *     top-level `libraryItems` array (no `elements`); the hook
 *     normalises to a scene shape with empty elements + populated
 *     library + sidebar pre-opened to the library tab.
 *   - **`.excalidraw.png` / `.excalidraw.svg`**: `content` is unused;
 *     the hook calls `extractScene(filePath)` which reads the binary
 *     via `read_binary_file` and runs Excalidraw's `loadFromBlob` to
 *     decode the embedded scene chunk.
 *
 * The load effect re-runs when `[filePath, content, needsExtract,
 * reloadKey]` change — `reloadKey` is bumped externally (by the
 * conflict-banner Reload click) to force a re-extract for binary
 * variants whose underlying disk content changed but `content` is
 * sentinel-empty.
 *
 * Extracted from `ExcalidrawView.tsx` in iter-12 (architect blocker
 * #1 — file size cap rule 23 in `docs/architecture.md`).
 */
export interface SceneState {
  scene: ExcalidrawScene | null;
  loadError: string | null;
  /**
   * Iter-21 (#352 P0-2) — monotonic counter that increments ONLY
   * when a scene load successfully commits (canonical JSON parse OR
   * `extractScene` for binary variants). Used by `ExcalidrawView`
   * as the React key on `<Excalidraw>` so the canvas remounts
   * exactly when the new initialData is ready.
   *
   * The previous design keyed Excalidraw on a synchronous reloadKey
   * bumped at conflict-banner Reload click time. That mounted a
   * fresh Excalidraw instance with the OLD scene (because content
   * had not yet been re-read), Excalidraw cached the stale
   * initialData, and the next user edit autosaved the stale draft
   * over the external version — silent data loss
   * (bug-expert P0-2).
   */
  loadVersion: number;
}

export function useExcalidrawScene(
  filePath: string,
  content: string,
  needsExtract: boolean,
  reloadKey: number,
): SceneState {
  const [scene, setScene] = useState<ExcalidrawScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (needsExtract) {
      // PNG / SVG variant — Excalidraw's loadFromBlob decodes the embedded
      // scene chunk. Wrapped in startTransition so a 5MB PNG decode doesn't
      // block urgent UI updates (perf rule 12, mirrors useSourceHighlighting).
      extractScene(filePath)
        .then((extracted) => {
          if (cancelled) return;
          startTransition(() => {
            setScene(extracted);
            setLoadError(null);
            // Iter-21 (#352 P0-2) — bump version EXACTLY when the
            // new scene commits. ExcalidrawView keys the canvas on
            // this counter so the remount aligns with the new
            // initialData being available, not with the user's
            // Reload click (which is synchronous + async-disjoint).
            setLoadVersion((v) => v + 1);
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          void logWarn(`excalidraw extractScene failed: ${msg}`);
          setLoadError(msg);
          setScene(null);
        });
    } else {
      // Canonical `.excalidraw` / `.excalidrawlib` — `content` is JSON text.
      try {
        const parsed = JSON.parse(content) as {
          type?: string;
          elements?: ReadonlyArray<unknown>;
          appState?: Record<string, unknown>;
          files?: Record<string, unknown>;
          libraryItems?: ReadonlyArray<unknown>;
        };
        // `.excalidrawlib` files have a top-level `libraryItems` array,
        // NOT `elements`. Pass them via `initialData.libraryItems` so
        // Excalidraw shows the library panel populated. Pre-open the
        // library sidebar so the grid is visible without a click.
        // Excalidraw's sidebar API is `{ name: DEFAULT_SIDEBAR.name,
        // tab: <tabId> }` where `DEFAULT_SIDEBAR.name === "default"` and
        // the library tab is `"library"`.
        const isLib =
          parsed.type === "excalidrawlib" ||
          filePath.toLowerCase().endsWith(".excalidrawlib");
        const next: ExcalidrawScene = isLib
          ? {
              elements: [],
              appState: { openSidebar: { name: "default", tab: "library" } },
              files: {},
              libraryItems: parsed.libraryItems ?? [],
            }
          : {
              elements: parsed.elements ?? [],
              appState: parsed.appState ?? {},
              files: parsed.files ?? {},
              libraryItems: null,
            };
        startTransition(() => {
          setScene(next);
          setLoadError(null);
          // Iter-21 (#352 P0-2) — see PNG/SVG branch above.
          setLoadVersion((v) => v + 1);
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void logWarn(`excalidraw JSON parse failed: ${msg}`);
        startTransition(() => {
          setLoadError(msg);
          setScene(null);
        });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, content, needsExtract, reloadKey]);

  return { scene, loadError, loadVersion };
}
