import { Excalidraw } from "@excalidraw/excalidraw";
import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";

import { SkeletonLoader } from "./SkeletonLoader";

import { useTheme } from "@/hooks/useTheme";
import { extractScene, type ExcalidrawScene } from "@/lib/excalidraw/extractScene";
import { saveExcalidrawFile } from "@/lib/excalidraw/saveScene";
import { useStore } from "@/store";
import { warn as logWarn, error as logError } from "@/logger";

import "@excalidraw/excalidraw/index.css";
import "@/styles/viewer-banner.css";

/**
 * Excalidraw asset path — fonts vendored into `public/excalidraw-assets/`
 * by the Vite plugin `excalidrawAssetCopy` (see `vite.config.ts`). Set at
 * module-scope so it fires once when the lazy chunk first evaluates,
 * BEFORE any `<Excalidraw>` renders. Re-running it inside the component
 * body would trigger React StrictMode's double-mount path twice, so
 * keeping it module-scope is essential. See `docs/features/excalidraw.md`.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}
if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";
}

/**
 * UIOptions frozen at module scope so object identity stays stable across
 * renders — Excalidraw's internal shallow-compare can then skip the
 * reconfigure path (same pattern as `MD_COMPONENTS` in
 * `MarkdownComponentsMap`, per design-patterns.md rule 11).
 *
 * The four explicitly-disabled `canvasActions` keys are AC4's literal spec
 * for "built-in Excalidraw Open / Save / Export are hidden":
 *   - `loadScene`         — Excalidraw's built-in "Open" picker (we own routing).
 *   - `saveAsImage`       — Excalidraw's "Save as Image" (we use Reveal in folder).
 *   - `saveToActiveFile`  — Excalidraw's built-in save (workspace-write IPC ships in iter 3).
 *   - `export`            — Excalidraw's "Export" (out of scope for the carve-out).
 *   - `toggleTheme`       — app-level theme is the source of truth.
 */
const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    export: false,
    toggleTheme: false,
    changeViewBackgroundColor: true,
    clearCanvas: true,
  },
} as const;

interface Props {
  /** Source bytes. For `.excalidraw` / `.excalidrawlib` this is the raw JSON
   *  text. For `.excalidraw.png` / `.excalidraw.svg` it's ignored — the
   *  scene is re-fetched via `extractScene(filePath)` from the binary. */
  content: string;
  /** Canonical workspace path of the file. */
  filePath: string;
  /** Visual or Editor sub-mode (Source mode is rendered by `<SourceView/>`,
   *  not this component — see `EnhancedViewer.renderVisualView`). */
  mode: "visual" | "editor";
  /** True for `.excalidraw.png` / `.excalidraw.svg` — needs binary scene
   *  extraction. False for canonical `.excalidraw` / `.excalidrawlib`
   *  (content is already JSON text). */
  needsExtract: boolean;
}

/**
 * Custom DOM event name dispatched by Save button + Ctrl+S to ask the
 * mounted `ExcalidrawView` (which alone holds the live scene state) to
 * persist its current scene through the workspace-write IPC. Detail shape
 * is `{ path: string }` so the right view responds when multiple are
 * mounted (only one can be active at a time, but `key={path}` guarantees
 * we only mount the active one).
 */
export const EXCALIDRAW_SAVE_REQUEST = "mdownreview:excalidraw-save-request";

export function ExcalidrawView({ content, filePath, mode, needsExtract }: Props) {
  const theme = useTheme();
  const excalidrawTheme: "light" | "dark" = theme === "dark" ? "dark" : "light";

  const [scene, setScene] = useState<ExcalidrawScene | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Issue #352 / iter-3 product-review fix — save failures MUST NOT
  // unmount the canvas (would discard the user's unsaved work). Track
  // save errors separately from load errors and surface them as a
  // non-modal banner above the canvas, alongside the conflict banner.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Latest scene snapshot from Excalidraw's `onChange` — captured into a
  // ref so the save handler reads the current value without re-creating
  // the listener on every keystroke. Mirrors the pattern in `useImageData`
  // for one-shot listeners with always-fresh reads.
  const liveSceneRef = useRef<ExcalidrawScene | null>(null);

  // Tab-scoped dirty + pending-conflict state. Reads from the tabs slice
  // via narrow selectors (rule 30 Warm-tier subscription discipline) so
  // unrelated tab mutations don't re-render this view.
  const dirty = useStore((s) => s.excalidrawDirtyByTab[filePath] === true);
  const externalChangePending = useStore(
    (s) => s.externalChangePendingByTab[filePath] === true,
  );
  const setExcalidrawDirty = useStore((s) => s.setExcalidrawDirty);
  const setExternalChangePending = useStore((s) => s.setExternalChangePending);

  // Issue #352 / AC5 — track whether Excalidraw's initial mount-restore
  // `onChange` has fired. Replaces the prior `userEditCountRef`
  // (counter-as-boolean — flagged by lean-expert). Boolean intent is
  // clearer; reset on filePath/content/mode changes so the next mount
  // restart correctly skips its first onChange.
  const mountedOnChangeFiredRef = useRef(false);
  // Issue #352 / iter-3 bug-expert review — guard against concurrent
  // saves. If the user mashes Ctrl+S, two near-simultaneous saves can
  // race and leave on-disk content with stale bytes. Atomic-write at
  // the IPC level prevents torn writes but cannot reorder saves.
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    mountedOnChangeFiredRef.current = false;

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
          elements?: ReadonlyArray<unknown>;
          appState?: Record<string, unknown>;
          files?: Record<string, unknown>;
        };
        startTransition(() => {
          setScene({
            elements: parsed.elements ?? [],
            appState: parsed.appState ?? {},
            files: parsed.files ?? {},
          });
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
  }, [filePath, content, needsExtract, mode]);

  // Issue #352 / iter-3 rubber-duck review (extra blind spot) — clear
  // the dirty + pending flags when this view unmounts. The live scene
  // state lives only in the mounted Excalidraw component; once the
  // active tab changes, the scene is gone and any dirty flag would
  // silently mislabel a stale on-disk reload as "unsaved edits". The
  // user is in the same situation as switching out of Editor mode
  // (`setViewMode` already clears dirty/pending) — be consistent.
  useEffect(() => {
    return () => {
      setExcalidrawDirty(filePath, false);
      setExternalChangePending(filePath, false);
    };
  }, [filePath, setExcalidrawDirty, setExternalChangePending]);

  // Listen for Save requests dispatched from the Save button + Ctrl+S
  // handler. Only the view whose `filePath` matches the event detail
  // responds. Scope to Editor mode — saving from Visual would persist
  // a stale snapshot.
  useEffect(() => {
    if (mode !== "editor") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string } | undefined;
      if (!detail || detail.path !== filePath) return;
      // In-flight guard — a second save request while the first is in
      // progress is a no-op. The Rust side does atomic-write but cannot
      // reorder two near-simultaneous IPC calls, so we serialize at
      // the renderer boundary.
      if (saveInFlightRef.current) {
        void logWarn(`excalidraw save dropped (already in flight): ${filePath}`);
        return;
      }
      const live = liveSceneRef.current ?? scene;
      if (!live) return;
      saveInFlightRef.current = true;
      void saveExcalidrawFile(filePath, {
        elements: live.elements,
        appState: live.appState,
        files: live.files,
      })
        .then(() => {
          // Success — clear dirty, clear any pending external-change
          // banner (the user explicitly chose to overwrite by saving),
          // clear any prior save error, and let the watcher echo
          // through. The watcher's self-write suppression in
          // src-tauri/src/commands/fs_write.rs (atomic rename —
          // debounced) is documented in docs/architecture.md.
          setExcalidrawDirty(filePath, false);
          setExternalChangePending(filePath, false);
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          void logError(`excalidraw save failed for ${filePath}: ${msg}`);
          // Surface as a non-modal banner above the canvas — DO NOT
          // route through `setLoadError`, which would unmount the
          // canvas and discard the user's unsaved edits (rubber-duck +
          // product-expert blockers, iter-3 review). Dirty stays
          // true so the user can retry; the Save button stays "live".
          setSaveError(msg);
        })
        .finally(() => {
          saveInFlightRef.current = false;
        });
    };
    window.addEventListener(EXCALIDRAW_SAVE_REQUEST, handler);
    return () => window.removeEventListener(EXCALIDRAW_SAVE_REQUEST, handler);
  }, [mode, filePath, scene, setExcalidrawDirty, setExternalChangePending]);

  const deferredScene = useDeferredValue(scene);

  if (loadError) {
    return (
      <div
        className="enhanced-viewer-content excalidraw-view excalidraw-view--error"
        data-testid="excalidraw-shell"
        data-mode={mode}
        data-path={filePath}
      >
        <p style={{ padding: "1rem", color: "var(--color-error, #c00)" }}>
          Failed to load Excalidraw scene: {loadError}
        </p>
      </div>
    );
  }

  if (!deferredScene) {
    return (
      <div
        className="enhanced-viewer-content excalidraw-view"
        data-testid="excalidraw-shell"
        data-mode={mode}
        data-path={filePath}
      >
        <SkeletonLoader />
      </div>
    );
  }

  return (
    <div
      className="enhanced-viewer-content excalidraw-view"
      data-testid="excalidraw-shell"
      data-mode={mode}
      data-path={filePath}
      data-dirty={dirty || undefined}
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}
    >
      {mode === "editor" && saveError && (
        <div
          className="excalidraw-save-error-banner"
          role="status"
          data-testid="excalidraw-save-error-banner"
        >
          <span className="excalidraw-save-error-banner__copy">
            Save failed: {saveError}
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {mode === "editor" && externalChangePending && (
        <div
          className="excalidraw-conflict-banner"
          role="status"
          data-testid="excalidraw-conflict-banner"
        >
          <span className="excalidraw-conflict-banner__copy">
            File changed on disk
          </span>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Reload — clear dirty so the next file-changed event is
              // treated as a normal reload (not a conflict), clear the
              // pending banner, then dispatch a synthetic file-changed
              // DOM event so `useFileContent` picks up the on-disk
              // version. Same event shape as the watcher emits (see
              // useFileWatcher.ts:74).
              setExcalidrawDirty(filePath, false);
              setExternalChangePending(filePath, false);
              window.dispatchEvent(
                new CustomEvent("mdownreview:file-changed", {
                  detail: { path: filePath, kind: "content" },
                }),
              );
            }}
          >
            Reload
          </button>
          <button
            type="button"
            className="excalidraw-conflict-banner__action"
            onClick={() => {
              // Keep editing — clear pending only; dirty stays true so
              // the next Save will overwrite the on-disk version.
              setExternalChangePending(filePath, false);
            }}
          >
            Keep editing — your save will overwrite
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw
          initialData={{
            elements: deferredScene.elements as never,
            appState: deferredScene.appState as never,
            files: deferredScene.files as never,
          }}
          viewModeEnabled={mode === "visual"}
          theme={excalidrawTheme}
          UIOptions={UI_OPTIONS}
          langCode="en"
          onChange={(elements, appState, files) => {
            // Always capture the latest snapshot for the save handler.
            liveSceneRef.current = {
              elements: elements as ReadonlyArray<unknown>,
              appState: appState as unknown as Record<string, unknown>,
              files: files as unknown as Record<string, unknown>,
            };
            // Only mark dirty in Editor mode AND after the initial
            // mount/restore call (which fires synchronously with the
            // restored scene — that's not a user edit). Boolean ref
            // (replaces prior counter) is reset in the load `useEffect`
            // on every filePath/content/mode change so the next mount
            // restart correctly skips its first onChange.
            if (mode !== "editor") return;
            if (!mountedOnChangeFiredRef.current) {
              mountedOnChangeFiredRef.current = true;
              return;
            }
            // setExcalidrawDirty short-circuits when the boolean is
            // unchanged, so we don't pay a re-render per mouse-move.
            setExcalidrawDirty(filePath, true);
          }}
        />
      </div>
    </div>
  );
}
