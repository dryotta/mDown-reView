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
}

export function useExcalidrawScene(
  filePath: string,
  content: string,
  needsExtract: boolean,
  reloadKey: number,
): SceneState {
  const [scene, setScene] = useState<ExcalidrawScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return { scene, loadError };
}
